/**
 * Gong Agent
 *
 * Surfaces:
 *   - Calls from the last 24 h and their key moments
 *   - Deal risk signals flagged by Gong AI
 *   - Recommended next steps from recent calls
 *   - Competitor mentions
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';

const GONG_BASE = 'https://api.gong.io/v2';

async function gongGet(path, params = {}) {
  const token = Buffer.from(
    `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
  ).toString('base64');

  const url = new URL(`${GONG_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Gong ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gongPost(path, body) {
  const token = Buffer.from(
    `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
  ).toString('base64');

  const res = await fetch(`${GONG_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gong POST ${res.status}: ${await res.text()}`);
  return res.json();
}

class GongAgent extends BaseAgent {
  constructor() { super('gong'); }

  async fetch(_exec, date) {
    const fromDate = new Date(date);
    fromDate.setDate(fromDate.getDate() - 1);

    // List calls in the last 24 h
    const callsRes = await gongPost('/calls/extensive', {
      filter: {
        fromDateTime: fromDate.toISOString(),
        toDateTime: new Date(date + 'T23:59:59Z').toISOString(),
      },
      contentSelector: {
        exposedFields: {
          parties: true,
          content: { structure: true, topics: true, trackers: true },
          interaction: { speakers: true },
          collaboration: { publicComments: true },
        },
      },
    });

    return { calls: callsRes.calls ?? [] };
  }

  async analyse(raw, exec, _date) {
    if (raw.calls.length === 0) {
      return {
        source: 'gong',
        summary: 'No Gong calls recorded in the last 24 hours.',
        items: [],
        urgentFlags: [],
      };
    }

    const summary = await claudeAnalyse(`
You are summarising Gong call intelligence for ${exec.name}, ${exec.role} at Rokt.

Recent calls (last 24 h):
${JSON.stringify(raw.calls.map(c => ({
  title: c.metaData?.title,
  duration: c.metaData?.duration,
  parties: c.parties,
  topics: c.content?.topics,
  trackers: c.content?.trackers,
  comments: c.collaboration?.publicComments,
})), null, 2)}

Write a concise call intelligence briefing:
1. Most important call outcomes and next steps
2. Deal risk signals (competitor mentions, objections, stalls)
3. Anything requiring exec follow-up

Return JSON: { summary, items: [{ emoji, text, urgency, callTitle? }], urgentFlags }
`, 'json');

    return {
      source: 'gong',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
      raw: { callCount: raw.calls.length },
    };
  }
}

export default new GongAgent();
