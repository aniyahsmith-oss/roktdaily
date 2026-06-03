/**
 * Q&A Conversation Handler
 *
 * Allows the exec to ask follow-up questions against today's briefing data.
 * The same source-agent cache is reused — no extra API calls.
 *
 * Usage:
 *   const qa = new ConversationSession(exec, date, sourceData);
 *   const answer = await qa.ask("Which deals are most at risk this week?");
 */
import { claudeChat } from '../utils/claude.js';
import { appendMessage, getHistory } from '../db/database.js';
import { randomUUID } from 'crypto';
import { format } from 'date-fns';

export class ConversationSession {
  /**
   * @param {object} exec        - executive row with preferences
   * @param {string} date        - YYYY-MM-DD
   * @param {object} sourceData  - { hubspot: {...}, gong: {...}, ... }
   * @param {string} sessionId   - optional — pass to resume a session
   */
  constructor(exec, date, sourceData, sessionId = null) {
    this.exec = exec;
    this.date = date ?? format(new Date(), 'yyyy-MM-dd');
    this.sourceData = sourceData;
    this.sessionId = sessionId ?? randomUUID();
  }

  get systemPrompt() {
    return `
You are Rokt Daily, the personal intelligence assistant for ${this.exec.name}, ${this.exec.role} at Rokt.
Today is ${this.date}.

You have access to today's briefing data from all sources. Use it to answer questions accurately.
Be concise, direct, and proactively surface implications the exec might not have asked for.
If you don't know something or the data doesn't cover it, say so — don't invent.

Briefing data context:
${JSON.stringify(this.sourceData, null, 2)}
`.trim();
  }

  async ask(question) {
    // Persist the user message
    appendMessage(this.exec.id, this.sessionId, 'user', question);

    // Build message history (last 10 turns for context window efficiency)
    const history = getHistory(this.sessionId, 10);

    const answer = await claudeChat(
      history.map(h => ({ role: h.role, content: h.content })),
      this.systemPrompt
    );

    // Persist the assistant reply
    appendMessage(this.exec.id, this.sessionId, 'assistant', answer);

    return answer;
  }
}

// ── Slack reply listener (webhook handler) ────────────────────────────────────
// Wire this into your Express / Fastify server for interactive Slack Q&A.
// When the exec replies to the morning brief thread, this handles it.

export async function handleSlackReply({ text, userId, threadTs }, getExecBySlackUid, loadSourceData) {
  const exec = await getExecBySlackUid(userId);
  if (!exec) return null;

  const date = format(new Date(), 'yyyy-MM-dd');
  const sourceData = await loadSourceData(exec, date);

  // threadTs scoped sessions ensure each day's brief has its own context
  const session = new ConversationSession(exec, date, sourceData, `slack-${threadTs}`);
  return session.ask(text);
}
