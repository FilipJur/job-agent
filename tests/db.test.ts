import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";

/** Schema as it was before the `partial` columns existed. */
const OLD_SCHEMA = `
CREATE TABLE offers (
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
CREATE TABLE runs (
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
function insertOffer(db: Database, sourceId = "1"): number {
  const row = db
    .query(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('jobscz', ?, 'https://www.jobs.cz/rpd/1/', 'AI Engineer', 'unknown', '', 'k', 't', 't', '{}') RETURNING id`,
    )
    .get(sourceId) as { id: number };
  return row.id;
}


describe("openDb on a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "job-agent-db-"));
  const path = join(dir, "nested", "jobs.db");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("applying the migration twice is idempotent and keeps data", () => {
    const first = openDb(path);
    insertOffer(first, "persisted");
    first.close();

    const second = openDb(path);
    expect(second.query("SELECT COUNT(*) AS n FROM offers").get()).toEqual({ n: 1 });
    second.close();
  });

  test("opening a database created by the old schema adds partial columns and backfills offers", () => {
    const oldPath = join(dir, "old.db");
    const old = new Database(oldPath, { create: true });
    old.run(OLD_SCHEMA);
    const insert = old.prepare(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('jobscz', ?, 'u', 't', 'unknown', '', 'k', 't', 't', ?)`,
    );
    insert.run("og", '{"card":{},"detail":{"shape":"og"}}');
    insert.run("jsonld", '{"card":{},"detail":{"shape":"jsonld"}}');
    insert.run("no-detail", '{"card":{},"detailError":"HTTP 503"}');
    old.run("INSERT INTO runs (source, started_at, status, fetched, new) VALUES ('jobscz', 't', 'ok', 2, 1)");
    old.close();

    const migrated = openDb(oldPath);
    expect(migrated.query("SELECT source_id, partial FROM offers ORDER BY source_id").all()).toEqual([
      { source_id: "jsonld", partial: 0 },
      { source_id: "no-detail", partial: 1 },
      { source_id: "og", partial: 1 },
    ]);
    expect(migrated.query("SELECT partial, detail_errors FROM runs").get()).toEqual({ partial: 0, detail_errors: 0 });
    migrated.close();
  });

  test("an existing database gains offer_scores, feedback, agencies, applications and drafts while keeping its offers", () => {
    const legacyPath = join(dir, "legacy.db");
    const legacy = openDb(legacyPath);
    const id = insertOffer(legacy, "kept");
    legacy.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, 'hpp', 'rule')", [id]);
    legacy.run("DROP TABLE offer_scores");
    legacy.run("DROP TABLE feedback");
    legacy.run("DROP TABLE agencies");
    legacy.run("DROP TABLE applications");
    legacy.run("DROP TABLE drafts");
    legacy.close();

    const migrated = openDb(legacyPath);
    expect(migrated.query("SELECT COUNT(*) AS n FROM offers").get()).toEqual({ n: 1 });
    expect(migrated.query("SELECT label FROM offer_labels").get()).toEqual({ label: "hpp" });
    for (const table of ["offer_scores", "feedback", "agencies", "applications", "drafts"]) {
      expect(migrated.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    migrated.close();
  });

  test("an agencies table with legacy crawl columns is migrated to the judgment columns", () => {
    const oldPath = join(dir, "agencies-old.db");
    const old = new Database(oldPath, { create: true });
    old.run("CREATE TABLE agencies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, fit INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', careers_url TEXT, hiring_ico INTEGER NOT NULL DEFAULT 0, hiring_evidence TEXT, hourly_rate TEXT, rate_min_czk INTEGER, rate_max_czk INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    old.run("INSERT INTO agencies (name, fit, careers_url, hiring_ico, hiring_evidence, hourly_rate, rate_min_czk, created_at, updated_at) VALUES ('A', 3, 'https://a.test/cenik', 1, 'quote', '650 Kč/h', 650, 't', 't')");
    old.close();

    const migrated = openDb(oldPath);
    expect(migrated.query("SELECT name, dev_position_open, dev_rate FROM agencies").all()).toEqual([
      { name: "A", dev_position_open: 0, dev_rate: null },
    ]);
    migrated.close();
  });

  test("a feedback table with the old CHECK is rebuilt: rows kept, aspiration and cleared accepted", () => {
    const oldPath = join(dir, "feedback-old.db");
    const old = openDb(oldPath);
    const id = insertOffer(old, "fb");
    old.run("DROP TABLE feedback");
    old.run("CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id INTEGER NOT NULL REFERENCES offers (id) ON DELETE CASCADE, verdict TEXT NOT NULL CHECK (verdict IN ('up', 'down', 'responded', 'hidden')), reason TEXT, created_at TEXT NOT NULL)");
    old.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, 'up', 'good', 't1'), (?, 'hidden', NULL, 't2')", [id, id]);
    expect(() => old.run("INSERT INTO feedback (offer_id, verdict, created_at) VALUES (?, 'aspiration', 't3')", [id])).toThrow();
    old.close();

    const migrated = openDb(oldPath);
    expect(migrated.query("SELECT verdict, reason FROM feedback ORDER BY id").all()).toEqual([
      { verdict: "up", reason: "good" },
      { verdict: "hidden", reason: null },
    ]);
    migrated.run("INSERT INTO feedback (offer_id, verdict, created_at) VALUES (?, 'aspiration', 't3')", [id]);
    migrated.run("INSERT INTO feedback (offer_id, verdict, created_at) VALUES (?, 'cleared', 't4')", [id]);
    expect(migrated.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_feedback_offer'").get()).toEqual({ n: 1 });
    migrated.close();
  });
});
