/**
 * Orchestrator
 *
 * Fans out to all source agents in parallel, collects results,
 * then calls the synthesis agent to produce the final brief.
 *
 * Returns: { briefMd, briefHtml, sourceData, urgentFlags }
 */
import { format } from 'date-fns';
import { claudeSynthesize } from './utils/claude.js';
import { log } from './utils/logger.js';
import { renderHtml } from './delivery/html-renderer.js';

// Source agents — add/remove as needed
import hubspotAgent from './agents/hubspot-agent.js';
import gongAgent from './agents/gong-agent.js';
import calendarAgent from './agents/calendar-agent.js';
import slackAgent from './agents/slack-agent.js';
import asanaAgent from './agents/asana-agent.js';
import analyticsAgent from './agents/analytics-agent.js';

const ALL_AGENTS = {
  hubspot:   hubspotAgent,
  gong:      gongAgent,
  calendar:  calendarAgent,
  slack:     slackAgent,
  asana:     asanaAgent,
  analytics: analyticsAgent,
};

/**
 * Run all source agents in parallel, then synthesize the brief.
 *
 * @param {object} exec   - executive row from DB (with preferences)
 * @param {string} date   - YYYY-MM-DD (defaults to today)
 * @param {boolean} force - bypass source cache
 */
export async function runBriefing(exec, date, force = false) {
  if (!date) date = format(new Date(), 'yyyy-MM-dd');

  // Determine which sources this exec cares about
  const enabledSources = (exec.sources ?? 'hubspot,gong,calendar,slack,asana,analytics')
    .split(',')
    .map(s => s.trim())
    .filter(s => ALL_AGENTS[s]);

  log.info(`Running briefing for ${exec.name} (${date}) — sources: ${enabledSources.join(', ')}`);

  // ── Fan out: run all agents in parallel ──────────────────────────────────
  const agentResults = await Promise.allSettled(
    enabledSources.map(source => ALL_AGENTS[source].run(exec, date, force))
  );

  const sourceData = {};
  const allUrgentFlags = [];

  for (let i = 0; i < enabledSources.length; i++) {
    const source = enabledSources[i];
    const result = agentResults[i];

    if (result.status === 'fulfilled') {
      sourceData[source] = result.value;
      allUrgentFlags.push(...(result.value.urgentFlags ?? []));
    } else {
      log.error(`Agent ${source} rejected: ${result.reason}`);
      sourceData[source] = { source, error: result.reason?.message, items: [], urgentFlags: [] };
    }
  }

  // ── Synthesise the final brief ────────────────────────────────────────────
  log.info('Synthesising brief…');
  const briefMd = await synthesise(exec, date, sourceData, allUrgentFlags);
  const briefHtml = renderHtml(exec, date, briefMd, sourceData, allUrgentFlags);

  log.success('Brief ready.');
  return { briefMd, briefHtml, sourceData, urgentFlags: allUrgentFlags };
}

async function synthesise(exec, date, sourceData, urgentFlags) {
  const prefs = exec.preferences;
  const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

  const system = `
You are Rokt Daily, the personal intelligence briefing assistant for ${exec.name}, ${exec.role} at Rokt.
Your tone is direct, confident, and warm — like a trusted chief of staff who knows exactly what matters.
Today is ${dayOfWeek}, ${date}.

Exec preferences:
${JSON.stringify(prefs, null, 2)}

Structure the morning brief as follows (in Markdown):
1. **Good morning, ${exec.name.split(' ')[0]}!** — 1-sentence framing of the day
2. **🚨 Needs your attention** — Only truly urgent items (if any). Be selective.
3. **📅 Your day** — Calendar highlights with pre-meeting context
4. **💼 Deal pulse** — Deal movements and pipeline intel from HubSpot + Gong
5. **📣 Listening in** — Key Slack threads and decisions
6. **✅ What shipped** — Content live, tasks completed, new tools built
7. **📊 Numbers** — Key metrics (if available)
8. **👋 Ask me anything** — Remind the exec they can reply to ask follow-up questions

Rules:
- Be concise. Executives read fast.
- Lead with what's most important, not what's most recent.
- Use emojis sparingly but purposefully.
- Never pad. If a section has nothing notable, skip it.
- Urgency scoring: only escalate items that genuinely need same-day action.
`.trim();

  const userContent = `
Here is the aggregated intelligence from all sources for ${date}:

${Object.entries(sourceData).map(([source, data]) => `
## ${source.toUpperCase()}
Summary: ${data.summary ?? 'n/a'}
Items:
${(data.items ?? []).map(i => `- ${i.emoji ?? '•'} [${i.urgency?.toUpperCase() ?? 'LOW'}] ${i.text}`).join('\n')}
${data.preMeetingBriefs?.length ? `\nPre-meeting briefs:\n${JSON.stringify(data.preMeetingBriefs, null, 2)}` : ''}
`).join('\n---\n')}

URGENT FLAGS (across all sources):
${urgentFlags.length ? urgentFlags.map(f => `- ${f}`).join('\n') : 'None'}

Now write the complete morning brief.
`.trim();

  return claudeSynthesize(system, userContent);
}
