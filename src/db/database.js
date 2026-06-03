import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

export function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH ?? './data/rokt-daily.db';
  // Ensure the data directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run schema migrations
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  _db.exec(schema);

  return _db;
}

// ── Exec helpers ──────────────────────────────────────────

export function getExec(email) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM executives WHERE email = ?').get(email);
  if (!row) return null;
  return { ...row, preferences: JSON.parse(row.preferences) };
}

export function upsertExec(exec) {
  const db = getDb();
  db.prepare(`
    INSERT INTO executives (email, name, role, preferences, sources, delivery, slack_uid)
    VALUES (@email, @name, @role, @preferences, @sources, @delivery, @slack_uid)
    ON CONFLICT(email) DO UPDATE SET
      name=excluded.name, role=excluded.role, preferences=excluded.preferences,
      sources=excluded.sources, delivery=excluded.delivery, slack_uid=excluded.slack_uid,
      updated_at=datetime('now')
  `).run({
    ...exec,
    preferences: typeof exec.preferences === 'string'
      ? exec.preferences
      : JSON.stringify(exec.preferences),
  });
  return getExec(exec.email);
}

// ── Cache helpers ─────────────────────────────────────────

export function getCached(execId, source, cacheKey, ttlMinutes = 30) {
  const db = getDb();
  const row = db.prepare(`
    SELECT payload, fetched_at FROM source_cache
    WHERE executive_id=? AND source=? AND cache_key=?
  `).get(execId, source, cacheKey);

  if (!row) return null;
  const age = (Date.now() - new Date(row.fetched_at).getTime()) / 60000;
  if (age > ttlMinutes) return null;
  return JSON.parse(row.payload);
}

export function setCache(execId, source, cacheKey, payload) {
  const db = getDb();
  db.prepare(`
    INSERT INTO source_cache (executive_id, source, cache_key, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(executive_id, source, cache_key) DO UPDATE SET
      payload=excluded.payload, fetched_at=datetime('now')
  `).run(execId, source, cacheKey, JSON.stringify(payload));
}

// ── Briefing run helpers ───────────────────────────────────

export function createRun(execId, runDate) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO briefing_runs (executive_id, run_date)
    VALUES (?, ?)
  `).run(execId, runDate);
  return info.lastInsertRowid;
}

export function updateRun(runId, fields) {
  const db = getDb();
  const sets = Object.keys(fields).map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE briefing_runs SET ${sets} WHERE id=@id`)
    .run({ ...fields, id: runId });
}

// ── Conversation helpers ───────────────────────────────────

export function appendMessage(execId, sessionId, role, content) {
  const db = getDb();
  db.prepare(`
    INSERT INTO conversations (executive_id, session_id, role, content)
    VALUES (?, ?, ?, ?)
  `).run(execId, sessionId, role, content);
}

export function getHistory(sessionId, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT role, content FROM conversations
    WHERE session_id=? ORDER BY id DESC LIMIT ?
  `).all(sessionId, limit).reverse();
}
