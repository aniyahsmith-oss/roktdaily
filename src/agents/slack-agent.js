/**
 * Slack Agent
 *
 * Surfaces:
 *   - Unread threads mentioning the exec or flagged channels
 *   - Important decisions made without exec awareness
 *   - Escalations / items needing approval
 *   - High-signal threads from key channels (e.g. #deals, #leadership)
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';

const SLACK_BASE = 'https://slack.com/api';

async function slackGet(method, params = {}) {
  const url = new URL(`${SLACK_BASE}/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

// Channels to monitor — configure via exec preferences
const DEFAULT_CHANNELS = ['deals', 'leadership', 'commercial', 'general', 'exec-alerts'];

class SlackAgent extends BaseAgent {
  constructor() { super('slack'); }

  async fetch(exec, date) {
    const prefs = exec.preferences;
    const channelNames = prefs.slackChannels ?? DEFAULT_CHANNELS;

    // Resolve channel names → IDs
    const channelList = await slackGet('conversations.list', {
      types: 'public_channel,private_channel',
      limit: 200,
      exclude_archived: true,
    });

    const channelMap = {};
    for (const ch of channelList.channels ?? []) {
      if (channelNames.includes(ch.name)) channelMap[ch.name] = ch.id;
    }

    const oldest = (new Date(date).getTime() / 1000) - 86400; // last 24 h
    const messages = [];

    for (const [name, id] of Object.entries(channelMap)) {
      try {
        const hist = await slackGet('conversations.history', {
          channel: id,
          oldest: String(oldest),
          limit: 30,
        });
        const channelMsgs = (hist.messages ?? [])
          .filter(m => m.type === 'message' && !m.bot_id)
          .map(m => ({ channel: name, text: m.text, ts: m.ts, reactions: m.reactions }));
        messages.push(...channelMsgs);
      } catch (_) { /* channel not accessible — skip */ }
    }

    // Fetch DMs / mentions
    const slackUid = exec.slack_uid;
    let mentions = [];
    if (slackUid) {
      try {
        const search = await slackGet('search.messages', {
          query: `<@${slackUid}>`,
          count: 10,
          sort: 'timestamp',
          sort_dir: 'desc',
        });
        mentions = search.messages?.matches ?? [];
      } catch (_) { /* search scope not available */ }
    }

    return { messages, mentions };
  }

  async analyse(raw, exec, _date) {
    const total = raw.messages.length + raw.mentions.length;
    if (total === 0) {
      return {
        source: 'slack',
        summary: 'No notable Slack activity in the last 24 hours.',
        items: [],
        urgentFlags: [],
      };
    }

    const summary = await claudeAnalyse(`
You are surfacing Slack intelligence for ${exec.name}, ${exec.role} at Rokt.

Messages from monitored channels (last 24 h):
${JSON.stringify(raw.messages.slice(0, 40), null, 2)}

Direct mentions of ${exec.name}:
${JSON.stringify(raw.mentions.slice(0, 10), null, 2)}

Identify:
1. Decisions made that ${exec.name} may need to know about
2. Escalations or items needing exec approval
3. High-signal discussions (big wins, problems, risks)
4. Anything explicitly directed at ${exec.name}

Ignore routine updates, congratulations, and low-signal chatter.

Return JSON: { summary, items: [{ emoji, text, urgency, channel? }], urgentFlags }
`, 'json');

    return {
      source: 'slack',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
      raw: { messageCount: raw.messages.length, mentionCount: raw.mentions.length },
    };
  }
}

export default new SlackAgent();
