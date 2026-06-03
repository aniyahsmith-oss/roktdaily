#!/usr/bin/env node
/**
 * Rokt Daily — Web App Server
 *
 * Serves the single-page Q&A + brief webapp and exposes the JSON API the
 * front-end calls. Run with:  npm run webapp
 *
 * Routes
 * ──────
 *   GET  /                     → public/index.html
 *   GET  /audio/:filename      → stream an MP3 from ./data/audio/
 *   POST /qa                   → text Q&A (Replit tools first, then conversation)
 *   POST /qa/voice             → voice Q&A (Whisper transcription → /qa logic)
 *   GET  /brief/today          → today's cached brief { briefMd, briefHtml, audioUrl }
 *   GET  /interview/questions  → INTERVIEW_QUESTIONS + pre-generated ElevenLabs audio
 *   POST /interview/answer     → transcribe + store a single interview answer
 *   POST /interview/complete   → run processInterview() → updated preferences
 *   GET  /registry             → list registered Replit apps
 *   POST /registry/register    → register a new Replit app
 */
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { format } from 'date-fns';

import { getExec, getDb, appendMessage, getHistory } from '../db/database.js';
import { runBriefing } from '../orchestrator.js';
import { ConversationSession } from '../qa/conversation.js';
import { runWithReplitTools, listApps, registerApp } from '../replit/registry.js';
import {
  INTERVIEW_QUESTIONS,
  transcribeAudio,
  processInterview,
  getQuestionAudio,
} from '../voice/interview.js';
import { briefAudioExists } from '../voice/audio-brief.js';
import { log } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../../public');
const AUDIO_DIR = resolve(__dirname, '../../data/audio');

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json({ limit: '2mb' }));

// Audio blobs arrive as multipart/form-data; keep them in memory (small clips).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const today = () => format(new Date(), 'yyyy-MM-dd');

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Load the source-agent data backing a Q&A session. Prefer today's cached run
 * (raw_data) so we don't re-synthesise; fall back to a fresh briefing run
 * (which itself uses the per-agent cache).
 */
async function loadSourceData(exec, date) {
  const db = getDb();
  const run = db.prepare(`
    SELECT raw_data FROM briefing_runs
    WHERE executive_id=? AND run_date=? AND raw_data IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(exec.id, date);

  if (run?.raw_data) {
    try { return JSON.parse(run.raw_data); } catch { /* fall through */ }
  }
  const { sourceData } = await runBriefing(exec, date);
  return sourceData;
}

/**
 * Core Q&A logic shared by /qa and /qa/voice.
 * Tries the Replit tool-use loop first; falls back to the cached-source conversation.
 */
async function answerQuestion(execEmail, sessionId, message) {
  const exec = getExec(execEmail);
  if (!exec) throw new Error(`No exec profile for ${execEmail}`);

  const date = today();
  const sourceData = await loadSourceData(exec, date);
  const session = new ConversationSession(exec, date, sourceData, sessionId);

  // Try Replit tools first (returns null if none are registered).
  const priorHistory = getHistory(session.sessionId, 10)
    .map(h => ({ role: h.role, content: h.content }));

  let answer = null;
  try {
    answer = await runWithReplitTools(message, priorHistory, session.systemPrompt);
  } catch (err) {
    log.error(`Replit tool loop failed, falling back to conversation: ${err.message}`);
  }

  if (answer) {
    // runWithReplitTools doesn't persist — record both turns ourselves.
    appendMessage(exec.id, session.sessionId, 'user', message);
    appendMessage(exec.id, session.sessionId, 'assistant', answer);
  } else {
    answer = await session.ask(message);
  }

  return { answer, sessionId: session.sessionId };
}

/**
 * Ensure a pre-generated ElevenLabs MP3 exists for an interview question.
 * Returns the public /audio URL, or null if generation isn't possible.
 */
async function ensureQuestionAudio(question) {
  const filename = `interview-${question.id}.mp3`;
  const filePath = join(AUDIO_DIR, filename);
  if (existsSync(filePath)) return `/audio/${filename}`;

  try {
    mkdirSync(AUDIO_DIR, { recursive: true });
    const buffer = await getQuestionAudio(question.text);
    writeFileSync(filePath, buffer);
    return `/audio/${filename}`;
  } catch (err) {
    log.error(`Could not generate audio for question ${question.id}: ${err.message}`);
    return null;
  }
}

// In-memory interview answer store: execEmail → Map(questionId → transcript).
// Lets /interview/complete fall back to server-side state if the client
// doesn't re-send every answer.
const interviewAnswers = new Map();

function storeInterviewAnswer(execEmail, questionId, transcript) {
  if (!interviewAnswers.has(execEmail)) interviewAnswers.set(execEmail, new Map());
  interviewAnswers.get(execEmail).set(questionId, transcript);
}

// ── Static front-end ────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

// ── Audio streaming ──────────────────────────────────────────────────────────────

app.get('/audio/:filename', (req, res) => {
  // Guard against path traversal — only serve a bare filename out of AUDIO_DIR.
  const filename = basename(req.params.filename);
  const filePath = join(AUDIO_DIR, filename);

  if (!existsSync(filePath)) return res.status(404).json({ error: 'Audio not found' });

  const { size } = statSync(filePath);
  const range = req.headers.range;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', size);
    createReadStream(filePath).pipe(res);
  }
});

// ── Q&A ──────────────────────────────────────────────────────────────────────────

app.post('/qa', async (req, res) => {
  try {
    const { execEmail, sessionId, message } = req.body ?? {};
    if (!execEmail || !message) {
      return res.status(400).json({ error: 'execEmail and message are required' });
    }
    const result = await answerQuestion(execEmail, sessionId ?? null, message);
    res.json(result);
  } catch (err) {
    log.error(`/qa failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/qa/voice', upload.single('audio'), async (req, res) => {
  try {
    const { execEmail, sessionId } = req.body ?? {};
    if (!execEmail) return res.status(400).json({ error: 'execEmail is required' });
    if (!req.file) return res.status(400).json({ error: 'audio file is required' });

    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    const result = await answerQuestion(execEmail, sessionId ?? null, transcript);
    res.json({ ...result, transcript });
  } catch (err) {
    log.error(`/qa/voice failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Today's brief ─────────────────────────────────────────────────────────────────

app.get('/brief/today', (req, res) => {
  try {
    const execEmail = req.query.execEmail ?? process.env.BRIEFING_EMAIL_TO;
    const exec = execEmail ? getExec(execEmail) : null;
    if (!exec) return res.status(404).json({ error: 'No exec profile found' });

    const db = getDb();
    const run = db.prepare(`
      SELECT id, brief_md, brief_html FROM briefing_runs
      WHERE executive_id=? AND run_date=? AND brief_md IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(exec.id, today());

    if (!run) return res.status(404).json({ error: 'No brief generated yet today' });

    const audioUrl = briefAudioExists(run.id) ? `/audio/brief-${run.id}.mp3` : null;
    res.json({ briefMd: run.brief_md, briefHtml: run.brief_html, audioUrl });
  } catch (err) {
    log.error(`/brief/today failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Quarterly interview ─────────────────────────────────────────────────────────────

app.get('/interview/questions', async (_req, res) => {
  try {
    const questions = await Promise.all(
      INTERVIEW_QUESTIONS.map(async (q) => ({
        id: q.id,
        text: q.text,
        audioUrl: await ensureQuestionAudio(q),
      }))
    );
    res.json({ questions });
  } catch (err) {
    log.error(`/interview/questions failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/interview/answer', upload.single('audio'), async (req, res) => {
  try {
    const { execEmail, questionId } = req.body ?? {};
    if (!execEmail || !questionId) {
      return res.status(400).json({ error: 'execEmail and questionId are required' });
    }
    if (!req.file) return res.status(400).json({ error: 'audio file is required' });

    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    storeInterviewAnswer(execEmail, questionId, transcript);
    res.json({ questionId, transcript });
  } catch (err) {
    log.error(`/interview/answer failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/interview/complete', async (req, res) => {
  try {
    const { execEmail, answers } = req.body ?? {};
    if (!execEmail) return res.status(400).json({ error: 'execEmail is required' });

    // Prefer client-supplied answers; otherwise fall back to the server-side store.
    let finalAnswers = answers;
    if (!Array.isArray(finalAnswers) || finalAnswers.length === 0) {
      const stored = interviewAnswers.get(execEmail);
      finalAnswers = stored
        ? Array.from(stored.entries()).map(([questionId, transcript]) => ({ questionId, transcript }))
        : [];
    }

    const result = await processInterview(execEmail, finalAnswers);
    interviewAnswers.delete(execEmail); // clear after a successful run
    res.json(result);
  } catch (err) {
    log.error(`/interview/complete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Replit app registry ───────────────────────────────────────────────────────────

app.get('/registry', (_req, res) => {
  try {
    res.json({ apps: listApps(false) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/registry/register', (req, res) => {
  try {
    const { name, description, url, inputSchema, ownerEmail } = req.body ?? {};
    if (!name || !description || !url) {
      return res.status(400).json({ error: 'name, description, and url are required' });
    }
    registerApp({ name, description, url, inputSchema, ownerEmail });
    res.json({ ok: true, apps: listApps(false) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  log.success(`Rokt Daily webapp listening on http://localhost:${PORT}`);
});

export { app };
