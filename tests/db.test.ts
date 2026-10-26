import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";

const OFFER_COLUMNS = [
  "id",
  "source",
  "source_id",
  "url",
  "title",
  "company",
  "location_text",
  "city",
  "workplace",
  "salary_min",
  "salary_max",
  "currency",
  "published_at",
  "description",
  "dedup_key",
  "first_seen_at",
  "last_seen_at",
  "raw_json",
];

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function insertOffer(db: Database, sourceId = "1"): number {
  const row = db
    .query(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('jobscz', ?, 'https://www.jobs.cz/rpd/1/', 'AI Engineer', 'unknown', '', 'k', 't', 't', '{}') RETURNING id`,
    )
    .get(sourceId) as { id: number };
  return row.id;
}

describe("openDb schema", () => {
  let db: Database;
  beforeAll(() => {
    db = openDb(":memory:");
  });
  afterAll(() => {
    db.close();
  });

  test("creates offers, offer_labels and runs with the expected columns", () => {
    expect(columnsOf(db, "offers")).toEqual(OFFER_COLUMNS);
    expect(columnsOf(db, "offer_labels")).toEqual(["offer_id", "label", "origin"]);
    expect(columnsOf(db, "runs")).toEqual(["id", "source", "started_at", "finished_at", "status", "fetched", "new", "error"]);
  });

  test("creates the dedup index (all statements of the schema are applied)", () => {
    const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toContain("idx_offers_dedup_key");
  });

  test("UNIQUE(source, source_id) is enforced", () => {
    insertOffer(db, "dup-1");
    expect(() => insertOffer(db, "dup-1")).toThrow(/UNIQUE/);
  });

  test("UNIQUE(offer_id, label) is enforced", () => {
    const id = insertOffer(db, "labels-1");
    db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, 'remote', 'rule')", [id]);
    expect(() => db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, 'remote', 'llm')", [id])).toThrow(
      /UNIQUE/,
    );
  });

  test("invalid workplace, run status and label origin are rejected by CHECK", () => {
    expect(() =>
      db.run(
        `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
         VALUES ('x', 'bad-wp', 'u', 't', 'moon', '', 'k', 't', 't', '{}')`,
      ),
    ).toThrow(/CHECK/);
    expect(() => db.run("INSERT INTO runs (source, started_at, status) VALUES ('x', 't', 'weird')")).toThrow(/CHECK/);
    const id = insertOffer(db, "bad-origin");
    expect(() => db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, 'x', 'human')", [id])).toThrow(
      /CHECK/,
    );
  });
});

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
    expect(columnsOf(second, "offers")).toEqual(OFFER_COLUMNS);
    expect(second.query("SELECT COUNT(*) AS n FROM offers").get()).toEqual({ n: 1 });
    second.close();
  });
});
