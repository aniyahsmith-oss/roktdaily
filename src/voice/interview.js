/**
 * Quarterly Voice Interview
 *
 * A guided 10-15 min spoken conversation that updates the executive's
 * preference profile. Called once per quarter (or on demand).
 *
 * Flow:
 *   1. Ask structured questions out loud (ElevenLabs TTS)
 *   2. Record exec's spoken answer (browser MediaRecorder → POST /interview/answer)
 *   3. Transcribe via OpenAI Whisper
 *   4. After all questions, Claude extracts structured preferences
 *   5. Write back to SQLite — next morning's brief reflects it immediately
 *
 * The interview is driven by the webapp (public/interview.html).
 * This module handles the server-side logic.
 */
import OpenAI from 'openai';
import { upsertExec, getExec } from '../db/database.js';
import { claudeAnalyse } from '../utils/claude.js';
import { textToSpeech } from './audio-brief.js';
import { log } from '../utils/logger.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Interview questions ────────────────────────────────────────────────────────
// Designed to sound natural when read by ElevenLabs.
// Claude synthesises preferences from the full transcript — not per-answer parsing.
export const INTERVIEW_QUESTIONS = [
  {
    id: 'quarter_theme',
    text: "Let's start at the top. What's the big theme for you this quarter — what are you trying to accomplish or prove?",
  },
  {
    id: 'deal_focus',
    text: "When you think about the pipeline right now, which deals or accounts are you watching most closely? You can name specific companies or just describe the types.",
  },
  {
    id: 'risks',
    text: "What keeps you up at night from a commercial perspective? What risks or signals do you want me to flag immediately if they appear?",
  },
  {
    id: 'relationships',
    text: "Are there specific people — prospects, partners, or internal — whose activity you want to track? Anyone you're trying to get in front of this quarter?",
  },
  {
    id: 'content_metrics',
    text: "What content or campaigns are live or launching soon that you want performance updates on?",
  },
  {
    id: 'noise_reduction',
    text: "What should I stop putting in your brief? What's been noise that you've been skipping?",
  },
  {
    id: 'morning_format',
    text: "Last one — how do you want to consume this? A quick listen on your commute, a scan over coffee, or both? And is there anything about the format or tone you'd change?",
  },
];

// ── Transcribe audio blob via Whisper ────────────────────────────────────────
export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  // Save to temp file (Whisper API requires a file)
  const tmpDir = './data/tmp';
  mkdirSync(tmpDir, { recursive: true });
  const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
  const tmpPath = join(tmpDir, `interview-${Date.now()}.${ext}`);
  writeFileSync(tmpPath, audioBuffer);

  const { default: fs } = await import('fs');
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tmpPath),
    model: 'whisper-1',
    language: 'en',
  });

  // Clean up
  fs.unlinkSync(tmpPath);
  return transcription.text;
}

// ── Extract structured preferences from full transcript ───────────────────────
export async function extractPreferences(execName, qaTranscript) {
  log.info('Extracting preferences from interview transcript…');

  const result = await claudeAnalyse(`
You are updating the preference profile for ${execName}, an executive at Rokt.

Below is a transcript of their quarterly briefing interview — questions and their spoken answers.

${qaTranscript}

Extract structured preferences for their morning briefing. Be specific and concrete — use their actual words where possible.

Return JSON:
{
  "quarterTheme": "string — their stated theme / goal for the quarter",
  "dealFocus": ["array of deal names, account names, or deal types they called out"],
  "riskSignals": ["array of risks or signals to flag immediately"],
  "watchedRelationships": ["people or companies to track"],
  "contentToWatch": ["campaigns or content to surface performance for"],
  "suppressedTopics": ["topics or signal types to remove from the brief"],
  "preferredFormat": "concise | standard | detailed",
  "preferredDelivery": "listen | read | both",
  "extraNotes": "any other preferences mentioned"
}
`, 'json');

  return result;
}

// ── Run a complete interview session (called by the webapp) ───────────────────
/**
 * @param {string} execEmail
 * @param {Array}  answers   - [{ questionId, transcript }] for all questions
 */
export async function processInterview(execEmail, answers) {
  const exec = getExec(execEmail);
  if (!exec) throw new Error(`No exec profile for ${execEmail}`);

  // Build a readable transcript
  const qaTranscript = INTERVIEW_QUESTIONS.map((q, i) => {
    const answer = answers.find(a => a.questionId === q.id);
    return `Q: ${q.text}\nA: ${answer?.transcript ?? '[no answer]'}`;
  }).join('\n\n');

  // Extract preferences
  const newPrefs = await extractPreferences(exec.name, qaTranscript);

  // Merge with existing preferences (don't wipe old keys not covered by interview)
  const merged = {
    ...exec.preferences,
    ...newPrefs,
    lastInterviewDate: new Date().toISOString().split('T')[0],
    interviewTranscript: qaTranscript,
  };

  // Persist
  upsertExec({ ...exec, preferences: merged });
  log.success(`Preferences updated for ${exec.name} from quarterly interview.`);

  return { preferences: merged, transcript: qaTranscript };
}

// ── Generate TTS audio for an interview question ─────────────────────────────
export async function getQuestionAudio(questionText) {
  return textToSpeech(questionText);
}
