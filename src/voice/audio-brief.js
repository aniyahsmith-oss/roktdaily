/**
 * ElevenLabs Audio Brief
 *
 * Converts the morning brief markdown into a spoken audio file.
 * Audio is generated at brief time and served from /audio/:runId.
 *
 * The HTML email includes a ▶ Listen button linking to the hosted audio.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { log } from '../utils/logger.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

// Default voice — "Rachel" is warm, clear, professional.
// Browse voices at elevenlabs.io/voice-library and update this ID.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';

const AUDIO_DIR = './data/audio';

/**
 * Convert text to speech via ElevenLabs.
 * Returns a Buffer of the MP3 audio.
 *
 * @param {string} text
 * @param {string} voiceId
 */
export async function textToSpeech(text, voiceId = DEFAULT_VOICE_ID) {
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Prepare the brief text for audio — strip markdown syntax so it reads naturally.
 */
function stripMarkdown(md) {
  return md
    .replace(/#{1,6}\s*/g, '')          // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')    // bold
    .replace(/\*(.*?)\*/g, '$1')        // italic
    .replace(/`([^`]+)`/g, '$1')        // inline code
    .replace(/^\s*[-*]\s+/gm, '')       // bullet points
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\n{3,}/g, '\n\n')         // excess newlines
    .trim();
}

/**
 * Generate audio for the morning brief and save to disk.
 * Returns the file path and a public URL segment.
 *
 * @param {number} runId     - briefing_runs.id
 * @param {string} briefMd   - the full brief markdown
 */
export async function generateBriefAudio(runId, briefMd) {
  mkdirSync(AUDIO_DIR, { recursive: true });

  const spokenText = stripMarkdown(briefMd);

  // ElevenLabs has a ~5000 char limit per request — chunk if needed
  const chunks = chunkText(spokenText, 4500);
  const buffers = [];

  for (let i = 0; i < chunks.length; i++) {
    log.info(`Generating audio chunk ${i + 1}/${chunks.length}…`);
    const buf = await textToSpeech(chunks[i]);
    buffers.push(buf);
  }

  const combined = Buffer.concat(buffers);
  const filename = `brief-${runId}.mp3`;
  const filePath = join(AUDIO_DIR, filename);
  writeFileSync(filePath, combined);

  log.success(`Audio brief saved: ${filePath} (${Math.round(combined.length / 1024)} KB)`);
  return { filePath, urlPath: `/audio/${filename}` };
}

/**
 * Check if audio already exists for a run (avoid re-generating).
 */
export function briefAudioExists(runId) {
  return existsSync(join(AUDIO_DIR, `brief-${runId}.mp3`));
}

function chunkText(text, maxLen) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += ' ' + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
