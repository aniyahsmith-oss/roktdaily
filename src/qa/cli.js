#!/usr/bin/env node
/**
 * Interactive Q&A CLI
 * Run: node src/qa/cli.js
 *
 * Loads today's brief from cache and lets you ask questions interactively.
 * Great for testing the Q&A experience before wiring up Slack/voice.
 */
import 'dotenv/config';
import readline from 'readline';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getExec, getDb } from '../db/database.js';
import { runBriefing } from '../orchestrator.js';
import { ConversationSession } from './conversation.js';

const email = process.env.BRIEFING_EMAIL_TO;
const date = format(new Date(), 'yyyy-MM-dd');

async function main() {
  const exec = getExec(email);
  if (!exec) {
    console.error(chalk.red(`No exec profile found for ${email}. Run: node src/onboarding/cli.js`));
    process.exit(1);
  }

  console.log(chalk.blue('\n🗞  Loading Rokt Daily…\n'));

  // Run briefing (uses cache if available)
  const { sourceData, briefMd } = await runBriefing(exec, date);

  console.log(chalk.gray('─'.repeat(60)));
  console.log(briefMd);
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.green('\n💬 Ask a question (ctrl+c to exit)\n'));

  const session = new ConversationSession(exec, date, sourceData);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(chalk.bold('You: '), async (question) => {
      if (!question.trim()) return ask();
      const answer = await session.ask(question);
      console.log(chalk.blue('\nRokt Daily: ') + answer + '\n');
      ask();
    });
  };

  ask();
}

main().catch(err => { console.error(err); process.exit(1); });
