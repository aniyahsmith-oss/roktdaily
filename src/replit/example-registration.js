/**
 * Example: How employees register their Replit apps with Rokt Daily.
 *
 * Run this script once after deploying a new Replit app:
 *   node src/replit/example-registration.js
 *
 * Or call registerApp() programmatically from your setup script.
 *
 * ─────────────────────────────────────────────────────────────
 * REPLIT APP CONTRACT
 *
 * Your Replit app must expose:
 *
 *   POST /query
 *   Body:  { "question": "...", ...any other inputs }
 *   Returns: { "answer": "...", "data": [...] }  (or any JSON)
 *
 * Example Express handler in your Replit app:
 *
 *   app.post('/query', async (req, res) => {
 *     const { question } = req.body;
 *     const result = await yourLogic(question);
 *     res.json({ answer: result.summary, data: result.rows });
 *   });
 * ─────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import { initRegistryTable, registerApp, listApps } from './registry.js';

initRegistryTable();

// ── Register your apps here ────────────────────────────────────────────────────

registerApp({
  name: 'partner-revenue-tracker',
  description: 'Returns partner revenue data, transaction counts, and ROAS metrics. Ask it about partner performance, revenue by partner, or transaction trends.',
  url: 'https://partner-revenue-tracker.yourname.repl.co',
  inputSchema: {
    partner_name: { type: 'string', description: 'Optional: filter to a specific partner' },
    period: { type: 'string', description: 'e.g. "last 7 days", "this month", "Q2 2026"' },
  },
  ownerEmail: 'engineer@rokt.com',
});

registerApp({
  name: 'content-performance',
  description: 'Returns performance metrics for Rokt content and campaigns. Ask about impressions, CTR, engagement, and which content is trending.',
  url: 'https://content-perf.yourname.repl.co',
  ownerEmail: 'marketing@rokt.com',
});

registerApp({
  name: 'deal-room-intel',
  description: 'Aggregates deal room activity — document views, stakeholder engagement, time-in-stage. Useful for understanding where deals are actually moving.',
  url: 'https://deal-room.yourname.repl.co',
  ownerEmail: 'sales-ops@rokt.com',
});

// Add more apps as employees build them...

console.log('\nRegistered apps:');
console.table(listApps().map(a => ({ name: a.name, url: a.url, owner: a.owner_email })));
