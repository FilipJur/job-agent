import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { labeledOffers } from "../src/eval/labels";
import { computeMetrics, type EvalItem } from "../src/eval/metrics";
import { replayLabeled } from "../src/eval/replay";
import type { PostJson } from "../src/scoring/client";

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
  return db
    .query<{ id: number }, [string, string, string]>(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('t', ?, 'https://example.com/', ?, 'unknown', 'popis', ?, '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '{}')
       RETURNING id`,
    )
    .get(`s${seq}`, `Offer ${seq}`, `k${seq}`)!.id;
}

const feedback = (offerId: number, verdict: string, at: string) =>
  db.run("INSERT INTO feedback (offer_id, verdict, created_at) VALUES (?, ?, ?)", [offerId, verdict, at]);

const score = (offerId: number, value: number) =>
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, scored_at) VALUES (?, ?, 'r', '', 'm', 'h', '2026-10-26T10:00:00.000Z')",
    [offerId, value],
  );

describe("computeMetrics", () => {
  const items: EvalItem[] = [
    { offerId: 1, label: "positive", score: 8, verdict: "fit" },
    { offerId: 2, label: "positive", score: 5, verdict: "fit" },
    { offerId: 3, label: "positive", score: 3, verdict: "blocked" },
    { offerId: 4, label: "negative", score: 5, verdict: "fit" },
    { offerId: 5, label: "negative", score: 2, verdict: "blocked" },
    { offerId: 6, label: "aspiration", score: 9, verdict: "aspiration" },
    { offerId: 7, label: "positive", score: null, verdict: null },
  ];

  test("AUC counts ties as half; aspiration and unscored offers stay out of it", () => {
    // pairs: 8>5, 8>2, 5=5 (0.5), 5>2, 3<5, 3>2 → 4.5 / 6
    expect(computeMetrics(items).auc).toBe(0.75);
  });

  test("precision@k counts aspiration as positive and needs k scored offers", () => {
    const m = computeMetrics(items);
    // top 5 by score: #6 asp 9, #1 + 8, #2 + 5, #4 − 5, #3 + 3
    expect(m.precisionAt[5]).toBe(0.8);
    expect(m.precisionAt[10]).toBeNull();
    expect(m.unscored).toBe(1);
  });

  test("AUC is null when one class has no scored offer", () => {
    expect(computeMetrics(items.filter((i) => i.label !== "negative")).auc).toBeNull();
  });

  test("disagreements: wrong side of 5 only, worst first", () => {
    expect(computeMetrics(items).disagreements).toEqual([
      { offerId: 3, label: "positive", score: 3, severity: 2 },
    ]);
  });
});

describe("labeledOffers", () => {
  test("the latest feedback row decides; cleared removes the label", () => {
    const cleared = offer();
    feedback(cleared, "up", "2026-10-26T10:00:00.000Z");
    feedback(cleared, "cleared", "2026-10-26T11:00:00.000Z");
    const flipped = offer();
    feedback(flipped, "down", "2026-10-26T10:00:00.000Z");
    feedback(flipped, "up", "2026-10-26T10:00:00.000Z"); // same timestamp: the higher id wins
    score(flipped, 6);

    const labeled = labeledOffers(db);
    expect(labeled.map((o) => [o.offerId, o.label, o.latestScore?.score])).toEqual([[flipped, "positive", 6]]);
  });
});

describe("replayLabeled", () => {
  test("re-scores labeled offers without writing to the database", async () => {
    const good = offer();
    feedback(good, "up", "2026-10-26T10:00:00.000Z");
    score(good, 2);
    const bad = offer();
    feedback(bad, "hidden", "2026-10-26T10:00:00.000Z");
    offer(); // unlabeled: not replayed
    const reply = JSON.stringify({ verdict: "fit", score: 7, reason: "ok", gaps: "", blocker: "", direction: "", labels: ["ai-first"] });
    const calls: string[] = [];
    const postJson: PostJson = async (_url, body) => {
      calls.push(JSON.stringify(body));
      return {
        status: 200,
        body: JSON.stringify({ output: [{ type: "message", content: [{ text: reply }] }], usage: { input_tokens: 10, output_tokens: 5 } }),
      };
    };
    const count = (table: string) => db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
    const before = [count("offer_scores"), count("offer_labels")];

    const r = await replayLabeled(db, {
      profile: "p",
      model: "m",
      endpoint: "https://example.test",
      maxDescriptionChars: 100,
      apiKey: "k",
      sessionId: "s",
      postJson,
    });

    expect([count("offer_scores"), count("offer_labels")]).toEqual(before);
    expect(calls.length).toBe(2);
    expect(r.items.map((i) => [i.offerId, i.label, i.score])).toEqual([
      [good, "positive", 7],
      [bad, "negative", 7],
    ]);
    expect(r.metrics.auc).toBe(0.5);
    expect(r.promptTokens).toBe(20);
  });
});
