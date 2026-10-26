import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";

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
});
