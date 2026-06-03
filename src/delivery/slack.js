/**
 * Slack delivery — sends the brief as a DM to the executive.
 *
 * Uses Block Kit for a structured, scannable layout.
 * The brief markdown is chunked into Slack's 3000-char block limit.
 */
import { log } from '../utils/logger.js';
import { format } from 'date-fns';

const SLACK_BASE = 'https://slack.com/api';

async function slackPost(method, body) {
  const res = await fetch(`${SLACK_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

export async function sendBriefingSlack(exec, date, briefMd, urgentFlags, audioUrl = null) {
  const channel = exec.slack_uid ?? process.env.SLACK_DELIVERY_TARGET;
  if (!channel) throw new Error('No Slack target: set exec.slack_uid or SLACK_DELIVERY_TARGET');

  const dayStr = format(new Date(date), 'EEEE, MMMM d');
  const blocks = buildBlocks(exec, dayStr, briefMd, urgentFlags, audioUrl);

  log.info(`Sending Slack DM to ${channel}…`);
  await slackPost('chat.postMessage', { channel, blocks, text: `Rokt Daily — ${dayStr}` });
  log.success('Slack DM delivered.');
}

function buildBlocks(exec, dayStr, briefMd, urgentFlags, audioUrl = null) {
  const blocks = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `Rokt Daily — ${dayStr}`, emoji: true },
  });

  // Listen link — surfaces the spoken audio brief at the top
  if (audioUrl) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🎧 *<${audioUrl}|Listen to your brief>*  _~3 min · ElevenLabs_` },
    });
  }

  // Urgent flags
  if (urgentFlags.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚨 *Needs your attention*\n${urgentFlags.map(f => `• ${f}`).join('\n')}`,
      },
    });
  }

  blocks.push({ type: 'divider' });

  // Split markdown into chunks ≤ 3000 chars (Slack block limit)
  const chunks = chunkText(briefMd, 2900);
  for (const chunk of chunks) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }

  // Footer CTA
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `💬 Reply to this thread to ask a question about your brief. _Powered by Rokt Daily._`,
    }],
  });

  return blocks;
}

function chunkText(text, maxLen) {
  const chunks = [];
  // Split on paragraph boundaries where possible
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
