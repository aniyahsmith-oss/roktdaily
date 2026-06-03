#!/usr/bin/env node
/**
 * Executive Onboarding CLI
 *
 * Run once per executive to capture preferences.
 * Answers are stored in SQLite and shape each briefing.
 *
 * Usage: node src/onboarding/cli.js
 */
import 'dotenv/config';
import readline from 'readline';
import chalk from 'chalk';
import { upsertExec } from '../db/database.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (q, defaultVal = '') => new Promise(resolve => {
  const hint = defaultVal ? chalk.gray(` [${defaultVal}]`) : '';
  rl.question(`${q}${hint}: `, ans => resolve(ans.trim() || defaultVal));
});

const askMulti = async (q, options, defaults = []) => {
  console.log(`\n${q}`);
  options.forEach((o, i) => console.log(chalk.gray(`  ${i + 1}. ${o}`)));
  const ans = await ask(`Enter numbers (comma-separated, default: ${defaults.join(',')})`, defaults.join(','));
  const indices = ans.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < options.length);
  return indices.length ? indices.map(i => options[i]) : defaults.map(d => options.find(o => o === d) ?? d);
};

async function main() {
  console.log(chalk.bold.blue('\n✦ Rokt Daily — Executive Onboarding\n'));
  console.log(chalk.gray('This takes ~3 minutes. Answers shape your daily briefing.\n'));

  // ── Basic info ──────────────────────────────────────────
  const name = await ask('Full name');
  const email = await ask('Work email');
  const role = await ask('Role', 'CCO');
  const slackUid = await ask('Slack user ID (e.g. U0123456789 — find in your Slack profile)', '');

  // ── Deal preferences ────────────────────────────────────
  console.log(chalk.bold('\n📊 Deal Intelligence'));
  const dealThresholdStr = await ask('Minimum deal value to surface ($)', '100000');
  const dealValueThreshold = parseInt(dealThresholdStr.replace(/[^0-9]/g, ''));

  const dealStages = await askMulti(
    'Which deal stages matter to you?',
    ['Qualification', 'Discovery', 'Proposal', 'Contract Sent', 'Closed Won', 'Closed Lost', 'At Risk'],
    ['Proposal', 'Contract Sent', 'Closed Won', 'At Risk']
  );

  // ── Calendar preferences ────────────────────────────────
  console.log(chalk.bold('\n📅 Calendar'));
  const prepLeadHours = await ask('How many hours before a meeting do you want pre-meeting context?', '1');
  const externalOnly = await ask('Pre-meeting briefs for external meetings only? (y/n)', 'y');

  // ── Slack channels ──────────────────────────────────────
  console.log(chalk.bold('\n💬 Slack'));
  const slackChannelsStr = await ask(
    'Slack channels to monitor (comma-separated)',
    'deals,leadership,commercial,exec-alerts'
  );
  const slackChannels = slackChannelsStr.split(',').map(s => s.trim());

  // ── Sources ─────────────────────────────────────────────
  const sourceOptions = ['hubspot', 'gong', 'calendar', 'slack', 'asana', 'analytics'];
  const sources = await askMulti(
    'Which data sources do you want in your briefing?',
    sourceOptions,
    sourceOptions
  );

  // ── Delivery ────────────────────────────────────────────
  console.log(chalk.bold('\n📬 Delivery'));
  const deliveryOpts = ['email', 'slack', 'both'];
  const deliveryAns = await ask('Deliver via: email / slack / both', 'both');
  const delivery = deliveryOpts.includes(deliveryAns) ? deliveryAns : 'both';

  const briefingEmail = await ask('Email address for briefing', email);

  // ── Tone ────────────────────────────────────────────────
  console.log(chalk.bold('\n🎯 Briefing style'));
  const briefLength = await ask('Preferred brief length: concise / standard / detailed', 'standard');
  const focusAreas = await ask(
    'Top 3 things you care most about (comma-separated)',
    'deal velocity, at-risk accounts, content performance'
  );

  // ── Confirm ─────────────────────────────────────────────
  const prefs = {
    dealValueThreshold,
    dealStages,
    prepLeadHours: parseInt(prepLeadHours),
    externalMeetingsOnly: externalOnly.toLowerCase() === 'y',
    slackChannels,
    briefLength,
    focusAreas: focusAreas.split(',').map(s => s.trim()),
    briefingEmail,
  };

  console.log('\n' + chalk.bold('Summary:'));
  console.log(JSON.stringify({ name, email, role, delivery, sources, preferences: prefs }, null, 2));

  const confirm = await ask('\nSave this profile? (y/n)', 'y');
  if (confirm.toLowerCase() !== 'y') {
    console.log(chalk.yellow('Cancelled.'));
    rl.close();
    return;
  }

  upsertExec({
    name, email, role,
    preferences: prefs,
    sources: sources.join(','),
    delivery,
    slack_uid: slackUid || null,
  });

  console.log(chalk.green('\n✓ Profile saved. Run `npm run brief` to generate today\'s briefing.\n'));
  rl.close();
}

main().catch(err => { console.error(err); rl.close(); process.exit(1); });
