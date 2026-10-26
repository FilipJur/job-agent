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
  error       TEXT
);
`;

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA);
  return db;
}
