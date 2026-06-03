/**
 * Scheduler — runs the morning briefing on a cron schedule.
 *
 * Default: 6:30 AM Monday–Friday (configurable via BRIEF_CRON env var).
 * Also exports runForAll() for manual / test runs.
 */
import cron from 'node-cron';
import { format } from 'date-fns';
import { getDb } from './db/database.js';
import { runBriefing } from './orchestrator.js';
import { sendBriefingEmail } from './delivery/email.js';
import { sendBriefingSlack } from './delivery/slack.js';
import { renderHtml } from './delivery/html-renderer.js';
import { generateBriefAudio } from './voice/audio-brief.js';
import { createRun, updateRun } from './db/database.js';
import { log } from './utils/logger.js';

const CRON = process.env.BRIEF_CRON ?? '30 6 * * 1-5';
const TZ   = process.env.TIMEZONE ?? 'America/New_York';

export function startScheduler() {
  log.info(`Scheduler started — cron: "${CRON}" (${TZ})`);
  cron.schedule(CRON, () => runForAll(), { timezone: TZ });
}

export async function runForAll(dateOverride = null) {
  const date = dateOverride ?? format(new Date(), 'yyyy-MM-dd');
  const db = getDb();
  const execs = db.prepare('SELECT * FROM executives').all().map(e => ({
    ...e, preferences: JSON.parse(e.preferences),
  }));

  log.info(`Running briefings for ${execs.length} exec(s) — ${date}`);

  for (const exec of execs) {
    const runId = createRun(exec.id, date);
    try {
      updateRun(runId, { status: 'running' });

      let { briefMd, briefHtml, sourceData, urgentFlags } = await runBriefing(exec, date);

      // ── Generate the spoken audio brief, then build a public listen URL ──────
      let audioUrl = null;
      try {
        const { urlPath } = await generateBriefAudio(runId, briefMd);
        const baseUrl = (process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '');
        audioUrl = `${baseUrl}${urlPath}`;
        // Re-render the HTML so the email includes the ▶ Listen button.
        briefHtml = renderHtml(exec, date, briefMd, sourceData, urgentFlags, audioUrl);
      } catch (err) {
        log.error(`Audio brief generation failed (continuing without audio): ${err.message}`);
      }

      updateRun(runId, { status: 'generated', raw_data: JSON.stringify(sourceData), brief_md: briefMd, brief_html: briefHtml });

      // Deliver
      const channel = exec.delivery ?? 'both';

      if (channel === 'email' || channel === 'both') {
        await sendBriefingEmail(exec, date, briefHtml);
      }
      if (channel === 'slack' || channel === 'both') {
        await sendBriefingSlack(exec, date, briefMd, urgentFlags, audioUrl);
      }

      updateRun(runId, { status: 'success', delivered_at: new Date().toISOString() });
      log.success(`Brief delivered for ${exec.name}`);

    } catch (err) {
      log.error(`Failed for ${exec.name}: ${err.message}`);
      updateRun(runId, { status: 'error', error: err.message });
    }
  }
}
