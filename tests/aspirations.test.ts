import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { handle } from "../src/web/server";

let db: Database;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  seq = 0;
});

afterEach(() => {
  db.close();
});

function offer(): number {
  seq += 1;
  const insert = db.query<{ id: number }, [string, string]>(
    `INSERT INTO offers (source, source_id, url, title, company, city, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
     VALUES ('t', ?, 'https://example.com/', 'Offer', 'Acme', 'Olomouc', 'remote', '', ?, '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '{}')
     RETURNING id`,
  );
  const row = insert.get(`s${seq}`, `k${seq}`) as { id: number };
  return row.id;
}

function scored(id: number, verdict: string, score: number, direction = "", at = "t3"): void {
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, blocker, direction, scored_at) VALUES (?, ?, 'r', 'g', 'm', 'p1', ?, 'b', ?, ?)",
    [id, score, verdict, direction, at],
  );
}

describe("aspirations API", () => {
  test("lists latest-verdict aspirations in score order with direction", async () => {
    const low = offer();
    const high = offer();
    scored(low, "aspiration", 7, "learn X");
    scored(high, "aspiration", 9, "learn Y");
    scored(offer(), "fit", 10);
    scored(offer(), "blocked", 10);
    const flipped = offer();
    scored(flipped, "aspiration", 9, "", "t1");
    scored(flipped, "fit", 5, "", "t4");
    const res = await handle(new Request("http://localhost/api/aspirations"), db);
    const rows = (await res.json()) as { id: number; direction: string; score: number }[];
    expect(rows.map((r) => r.id)).toEqual([high, low]);
    expect(rows[0]).toMatchObject({ direction: "learn Y", score: 9 });
  });
});
