/**
 * Replit App Registry
 *
 * Employees register their Replit tools here so Rokt Daily can call them
 * as dynamic Claude tools during briefing and Q&A sessions.
 *
 * HOW IT WORKS
 * ─────────────
 * Each registered app exposes a simple HTTP endpoint that:
 *   - Accepts POST with a JSON body (the "input")
 *   - Returns JSON (the "output")
 *
 * The registry stores the app's name, description, URL, and input schema.
 * The orchestrator converts the registry into Claude tool definitions at
 * runtime, so Claude can decide whether to call them during a Q&A.
 *
 * EMPLOYEE GUIDE (share this with your team)
 * ───────────────────────────────────────────
 * To make your Replit app available in Rokt Daily:
 *
 * 1. Add a POST /query endpoint to your Replit app that accepts JSON and
 *    returns JSON. Example:
 *
 *    app.post('/query', (req, res) => {
 *      const { question } = req.body;
 *      // ... your logic ...
 *      res.json({ answer: '...', data: [...] });
 *    });
 *
 * 2. Register it below (or via POST /registry/register in the webapp).
 *
 * 3. Rokt Daily will automatically call your app when Claude decides it's
 *    relevant to a question or briefing section.
 */
import { getDb } from '../db/database.js';
import { log } from '../utils/logger.js';

// ── DB-backed registry ─────────────────────────────────────────────────────────
// Apps are stored in SQLite so they persist and can be managed via the webapp.

export function initRegistryTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS replit_apps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      url         TEXT NOT NULL,
      input_schema TEXT NOT NULL DEFAULT '{}',
      enabled     INTEGER DEFAULT 1,
      owner_email TEXT,
      last_called TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);
}

// Ensure the registry table exists as soon as this module is imported.
initRegistryTable();

export function registerApp({ name, description, url, inputSchema = {}, ownerEmail = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO replit_apps (name, description, url, input_schema, owner_email)
    VALUES (@name, @description, @url, @input_schema, @owner_email)
    ON CONFLICT(name) DO UPDATE SET
      description=excluded.description,
      url=excluded.url,
      input_schema=excluded.input_schema,
      owner_email=excluded.owner_email
  `).run({
    name, description, url,
    input_schema: JSON.stringify(inputSchema),
    owner_email: ownerEmail,
  });
  log.info(`Replit app registered: ${name}`);
}

export function listApps(enabledOnly = true) {
  const db = getDb();
  const rows = enabledOnly
    ? db.prepare('SELECT * FROM replit_apps WHERE enabled=1').all()
    : db.prepare('SELECT * FROM replit_apps').all();
  return rows.map(r => ({ ...r, inputSchema: JSON.parse(r.input_schema) }));
}

export function setAppEnabled(name, enabled) {
  getDb().prepare('UPDATE replit_apps SET enabled=? WHERE name=?').run(enabled ? 1 : 0, name);
}

// ── Convert registry → OpenAI tool definitions ────────────────────────────────

export function appsToOpenAITools() {
  const apps = listApps();
  return apps.map(app => ({
    type: 'function',
    function: {
      name: `replit_${app.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      description: app.description,
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question or query to send to this tool',
          },
          ...app.inputSchema,
        },
        required: ['question'],
      },
    },
    // Metadata for the executor — not sent to the model
    _appUrl: app.url,
    _appName: app.name,
  }));
}

// ── Call a registered app ─────────────────────────────────────────────────────

export async function callApp(toolName, input) {
  const apps = listApps();
  const appName = toolName.replace(/^replit_/, '').replace(/_/g, ' ');
  const app = apps.find(a =>
    `replit_${a.name.replace(/[^a-zA-Z0-9_]/g, '_')}` === toolName
  );

  if (!app) throw new Error(`No registered app for tool: ${toolName}`);

  log.info(`Calling Replit app: ${app.name} @ ${app.url}`);

  const res = await fetch(`${app.url}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (!res.ok) throw new Error(`Replit app ${app.name} returned ${res.status}`);

  // Track last called
  getDb().prepare('UPDATE replit_apps SET last_called=datetime("now") WHERE name=?').run(app.name);

  return res.json();
}

// ── Agentic loop: the model decides which apps to call ────────────────────────
/**
 * Given a question and available Replit tools, run a function-calling loop
 * where the model calls relevant apps and synthesises an answer.
 *
 * @param {string} question
 * @param {Array}  messages   - existing conversation history ({ role, content })
 * @param {string} systemPrompt
 */
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function runWithReplitTools(question, messages, systemPrompt) {
  const tools = appsToOpenAITools();
  if (tools.length === 0) return null; // no tools registered — caller falls back

  // Strip internal metadata before sending to the model
  const openaiTools = tools.map(({ _appUrl, _appName, ...t }) => t);

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
    { role: 'user', content: question },
  ];

  // Agentic loop — keep going until the model stops calling tools
  while (true) {
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      tools: openaiTools,
      messages: allMessages,
    });

    const choice = res.choices[0];
    const msg = choice.message;

    // No tool calls → we have the final answer
    if (choice.finish_reason === 'stop' || !msg.tool_calls?.length) {
      return msg.content ?? null;
    }

    // The assistant turn (with tool_calls) must be echoed back before tool results
    allMessages.push(msg);

    const toolResults = await Promise.all(
      msg.tool_calls.map(async (toolCall) => {
        let content;
        try {
          const input = JSON.parse(toolCall.function.arguments || '{}');
          const result = await callApp(toolCall.function.name, input);
          content = JSON.stringify(result);
        } catch (err) {
          content = JSON.stringify({ error: err.message });
        }
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        };
      })
    );

    allMessages.push(...toolResults);
  }
}
