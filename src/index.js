#!/usr/bin/env node
/**
 * Rokt Daily — Entry Point
 *
 * node src/index.js           → start the scheduler (keeps process alive)
 * node src/index.js --run-now → run once immediately and exit
 * node src/index.js --date 2026-06-01 → run for a specific date
 */
import 'dotenv/config';
import { startScheduler, runForAll } from './scheduler.js';
import { log } from './utils/logger.js';

const args = process.argv.slice(2);
const runNow = args.includes('--run-now');
const dateIdx = args.indexOf('--date');
const dateOverride = dateIdx !== -1 ? args[dateIdx + 1] : null;

if (runNow || dateOverride) {
  log.info('Running briefing now…');
  runForAll(dateOverride).then(() => {
    log.success('Done.');
    process.exit(0);
  }).catch(err => {
    log.error(err.message);
    process.exit(1);
  });
} else {
  log.info('Rokt Daily starting in scheduler mode…');
  startScheduler();
  // Keep process alive
  process.on('SIGINT', () => { log.info('Shutting down.'); process.exit(0); });
}
