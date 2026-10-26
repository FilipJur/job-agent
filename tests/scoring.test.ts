import { readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { parseScoreReply, type PostJson } from "../src/scoring/client";
import { runScoring } from "../src/scoring/run";

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
  const row = db
    .query<{ id: number }, [string, string, string]>(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('t', ?, 'https://example.com/', ?, 'unknown', 'popis', ?, '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '{}')
       RETURNING id`,
    )
    .get(`s${seq}`, `Offer ${seq}`, `k${seq}`) as { id: number };
  return row.id;
}

const envelope = (content: string): string =>
  JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

const validContent = JSON.stringify({ score: 7, reason: "Dobrý fit.", gaps: "", labels: ["remote-cz", "bogus"] });

function sequenced(bodies: string[]): PostJson {
  let i = 0;
  return async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    if (body === undefined) throw new Error("no fixture body");
    return { status: 200, body };
  };
}
const opts = (postJson: PostJson, profile = "profil kandidáta") => ({
  profile,
  model: "test-model",
  endpoint: "https://example.test/v1",
  maxDescriptionChars: 4000,
  apiKey: "k",
  sessionId: "s",
  now: () => "2026-10-26T10:00:00.000Z",
  postJson,
});

const scoresOf = (id: number) =>
  db.query<{ score: number; reason: string; gaps: string }, [number]>(
    "SELECT score, reason, gaps FROM offer_scores WHERE offer_id = ?",
  ).all(id);

const llmLabelsOf = (id: number) =>
  db
    .query<{ label: string }, [number]>("SELECT label FROM offer_labels WHERE offer_id = ? AND origin = 'llm'")
    .all(id)
    .map((r) => r.label);

describe("scoring", () => {
  test("recorded live response stores the score row and llm labels", async () => {
    const fixture = readFileSync(new URL("./fixtures/scoring/chat-completion.json", import.meta.url), "utf8");
    const expected = JSON.parse(JSON.parse(fixture).choices[0].message.content as string) as {
      score: number;
      reason: string;
      gaps: string;
      labels: string[];
    };
    const id = offer();
    const { summary, exitCode } = await runScoring(
      db,
      opts(async () => ({ status: 200, body: fixture })),
    );
    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({ scored: 1, failed: 0, skipped: 0 });
    expect(scoresOf(id)).toEqual([{ score: expected.score, reason: expected.reason, gaps: expected.gaps }]);
    for (const label of expected.labels) expect(llmLabelsOf(id)).toContain(label);
  });

  test("unknown labels are dropped", () => {
    expect(parseScoreReply(validContent)).toEqual({
      score: 7,
      reason: "Dobrý fit.",
      gaps: "",
      labels: ["remote-cz"],
    });
  });

  test("timed-out offer fails but the run continues", async () => {
    const ids = [offer(), offer()];
    let calls = 0;
    const postJson: PostJson = (...args) => {
      calls += 1;
      // Fake HTTP whose request never resolves before the abort: rejects with
      // TimeoutError like fetch under AbortSignal.timeout; no real timer, rejects at once.
      if (calls === 1) return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
      return sequenced([envelope(validContent)])(...args);
    };
    const { summary, exitCode } = await runScoring(db, opts(postJson));
    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({ scored: 1, failed: 1 });
    const scoredId = ids.find((id) => scoresOf(id).length === 1);
    expect(scoredId).toBeDefined();
    expect(llmLabelsOf(scoredId!)).toEqual(["remote-cz"]);
  });

  test("second run with the same profile scores nothing; changed profile scores again", async () => {
    offer();
    offer();
    const fake = sequenced([envelope(validContent)]);
    const first = await runScoring(db, opts(fake));
    expect(first.summary).toMatchObject({ scored: 2, failed: 0, skipped: 0 });
    const second = await runScoring(db, opts(fake));
    expect(second.summary).toMatchObject({ scored: 0, failed: 0, skipped: 2 });
    const third = await runScoring(db, opts(fake, "profil kandidáta\nDodatek."));
    expect(third.summary).toMatchObject({ scored: 2, skipped: 0 });
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM offer_scores").get()?.n).toBe(4);
  });
});
