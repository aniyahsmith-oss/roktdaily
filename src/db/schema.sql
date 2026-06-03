-- Rokt Daily — SQLite Schema

-- Executive profiles (one row per exec, created via onboarding Q&A)
CREATE TABLE IF NOT EXISTS executives (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,       -- e.g. "CCO"
  -- Serialised JSON of onboarding answers
  preferences TEXT NOT NULL DEFAULT '{}',
  -- Comma-separated source names they care about
  sources     TEXT NOT NULL DEFAULT 'hubspot,gong,calendar,slack,asana,analytics',
  delivery    TEXT NOT NULL DEFAULT 'both',  -- 'email' | 'slack' | 'both'
  slack_uid   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Briefing run log
CREATE TABLE IF NOT EXISTS briefing_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  executive_id  INTEGER NOT NULL REFERENCES executives(id),
  run_date      TEXT NOT NULL,               -- YYYY-MM-DD
  status        TEXT DEFAULT 'pending',      -- pending | success | error
  raw_data      TEXT,                        -- JSON from all source agents
  brief_md      TEXT,                        -- final markdown brief
  brief_html    TEXT,                        -- rendered HTML
  delivered_at  TEXT,
  error         TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Q&A conversation history (multi-turn, per exec)
CREATE TABLE IF NOT EXISTS conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  executive_id  INTEGER NOT NULL REFERENCES executives(id),
  session_id    TEXT NOT NULL,               -- UUID per session
  role          TEXT NOT NULL,               -- 'user' | 'assistant'
  content       TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Cached source-agent payloads (TTL: 30 min, re-used for Q&A in same session)
CREATE TABLE IF NOT EXISTS source_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  executive_id  INTEGER NOT NULL REFERENCES executives(id),
  source        TEXT NOT NULL,               -- 'hubspot' | 'gong' | etc.
  cache_key     TEXT NOT NULL,               -- YYYY-MM-DD
  payload       TEXT NOT NULL,               -- JSON
  fetched_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(executive_id, source, cache_key)
);

-- Contact-event cross-reference (prospect contacts at upcoming conferences)
CREATE TABLE IF NOT EXISTS contact_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  TEXT NOT NULL,                 -- HubSpot contact ID
  contact_name TEXT NOT NULL,
  company     TEXT,
  event_name  TEXT NOT NULL,
  event_date  TEXT,
  event_url   TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_briefing_exec_date
  ON briefing_runs(executive_id, run_date);
CREATE INDEX IF NOT EXISTS idx_cache_lookup
  ON source_cache(executive_id, source, cache_key);
CREATE INDEX IF NOT EXISTS idx_convo_session
  ON conversations(session_id);
