import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  company       TEXT,
  location_text TEXT,
  city          TEXT,
  workplace     TEXT NOT NULL CHECK (workplace IN ('remote','hybrid','onsite','unknown')),
  salary_min    INTEGER,
  salary_max    INTEGER,
  currency      TEXT,
  published_at  TEXT,
  description   TEXT NOT NULL,
  dedup_key     TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  raw_json      TEXT NOT NULL,
  partial       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_dedup_key ON offers (dedup_key);

CREATE TABLE IF NOT EXISTS offer_labels (
  offer_id INTEGER NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  origin   TEXT NOT NULL CHECK (origin IN ('rule','llm')),
  UNIQUE (offer_id, label)
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT CHECK (status IN ('ok','error')),
  fetched     INTEGER NOT NULL DEFAULT 0,
  new         INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  partial     INTEGER NOT NULL DEFAULT 0,
  detail_errors INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS offer_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id     INTEGER NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  score        REAL NOT NULL CHECK (score >= 0 AND score <= 10),
  reason       TEXT NOT NULL,
  gaps         TEXT NOT NULL,
  model        TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  scored_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offer_scores_offer ON offer_scores (offer_id);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id   INTEGER NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  verdict    TEXT NOT NULL CHECK (verdict IN ('up', 'down', 'responded', 'hidden')),
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_offer ON feedback (offer_id);

CREATE TABLE IF NOT EXISTS agencies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  web             TEXT,
  city            TEXT,
  focus           TEXT,
  stack           TEXT,
  signal          TEXT,
  contact_url     TEXT,
  email           TEXT,
  phone           TEXT,
  fit             INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'replied', 'meeting', 'work', 'declined')),
  notes           TEXT,
  last_contact_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
`;

const PARTIAL_BACKFILL = `
UPDATE offers SET partial = 1
WHERE json_extract(raw_json, '$.detail.shape') = 'og' OR json_extract(raw_json, '$.detail') IS NULL`;

/** Adds a column that an older schema lacks; `backfill` runs in the same transaction, only when the column is added. */
function addColumnIfMissing(db: Database, table: string, column: string, definition: string, backfill?: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.transaction(() => {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (backfill) db.run(backfill);
  })();
}

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // No WAL: its shared-memory index (-shm) is not shared between the macOS host and Docker
  // containers on a bind mount, so web and cli saw different database states.
  db.run("PRAGMA journal_mode = DELETE");
  // web and cli share the file; wait for the other writer instead of failing with SQLITE_BUSY.
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA);
  addColumnIfMissing(db, "offers", "partial", "INTEGER NOT NULL DEFAULT 0", PARTIAL_BACKFILL);
  addColumnIfMissing(db, "runs", "partial", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "detail_errors", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "agencies", "contact_url", "TEXT");
  // Filled by the agency website crawl (src/agencies/crawl.ts).
  addColumnIfMissing(db, "agencies", "careers_url", "TEXT");
  addColumnIfMissing(db, "agencies", "hiring_ico", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "agencies", "hiring_evidence", "TEXT");
  addColumnIfMissing(db, "agencies", "hourly_rate", "TEXT");
  addColumnIfMissing(db, "agencies", "rate_min_czk", "INTEGER");
  addColumnIfMissing(db, "agencies", "rate_max_czk", "INTEGER");
  addColumnIfMissing(db, "agencies", "crawled_at", "TEXT");
  return db;
}
