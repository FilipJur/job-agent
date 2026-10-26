import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { runCollectors } from "../src/pipeline";
import type { Collector, RawOffer } from "../src/types";

function raw(over: Partial<RawOffer> = {}): RawOffer {
  return {
    source: "fake",
    sourceId: "1",
    url: "https://www.jobs.cz/rpd/1/?rps=2&utm_source=x",
    title: "AI Engineer",
    company: "Acme s.r.o.",
    locationText: "Praha – Michle",
    city: "Praha",
    salaryMin: 90000,
    salaryMax: 120000,
    currency: "CZK",
    publishedAt: null,
    description: "Popis nabídky",
    tags: [],
    partial: false,
    raw: { id: 1 },
    ...over,
  };
}

function fake(name: string, offers: RawOffer[]): Collector {
  return { name, collect: async () => offers };
}

let db: Database;
let clock: Date;
const now = () => clock;

beforeEach(() => {
  db = openDb(":memory:");
  clock = new Date("2026-10-26T08:00:00Z");
});

afterEach(() => {
  db.close();
});

describe("runCollectors", () => {
  test("a throwing collector is recorded as error and the next collector still runs", async () => {
    const bad: Collector = {
      name: "bad",
      collect: async () => {
        throw new Error("boom");
      },
    };
    const good = fake("good", [raw({ source: "good", sourceId: "a", title: "A" }), raw({ source: "good", sourceId: "b", title: "B" })]);

    const summaries = await runCollectors(db, [bad, good], now);

    expect(summaries).toEqual([
      { source: "bad", status: "error", fetched: 0, new: 0, updated: 0, partial: 0, detailErrors: 0, error: "boom" },
      { source: "good", status: "ok", fetched: 2, new: 2, updated: 0, partial: 0, detailErrors: 0, error: null },
    ]);
    const runs = db.query("SELECT source, status, error, fetched, new, finished_at FROM runs ORDER BY id").all();
    expect(runs).toEqual([
      { source: "bad", status: "error", error: "boom", fetched: 0, new: 0, finished_at: "2026-10-26T08:00:00.000Z" },
      { source: "good", status: "ok", error: null, fetched: 2, new: 2, finished_at: "2026-10-26T08:00:00.000Z" },
    ]);
    expect(db.query("SELECT COUNT(*) AS n FROM offers").get()).toEqual({ n: 2 });
  });

  test("running the same collector twice creates no duplicates and only bumps last_seen_at", async () => {
    const c = fake("fake", [raw()]);

    const first = await runCollectors(db, [c], now);
    clock = new Date("2026-10-27T09:30:00Z");
    const second = await runCollectors(db, [c], now);

    expect(first[0]).toMatchObject({ status: "ok", fetched: 1, new: 1 });
    expect(second[0]).toMatchObject({ status: "ok", fetched: 1, new: 0 });
    const rows = db.query("SELECT first_seen_at, last_seen_at, url FROM offers").all();
    expect(rows).toEqual([
      {
        first_seen_at: "2026-10-26T08:00:00.000Z",
        last_seen_at: "2026-10-27T09:30:00.000Z",
        url: "https://www.jobs.cz/rpd/1/",
      },
    ]);
  });

  test("a previously failed detail is retried and the stored row is updated in place", async () => {
    const failed = raw({ sourceId: "retry-1", partial: true, description: "", city: null, raw: { detailError: "boom" } });
    await runCollectors(db, [fake("fake", [failed])], now);

    clock = new Date("2026-10-27T09:30:00Z");
    const full = raw({ sourceId: "retry-1", description: "Plně remote pozice", city: "Brno", raw: { id: 1 } });
    const summaries = await runCollectors(db, [fake("fake", [full])], now);

    expect(summaries[0]).toMatchObject({ status: "ok", fetched: 1, new: 0, updated: 1 });
    const rows = db
      .query<
        { description: string; city: string | null; workplace: string; partial: number; first_seen_at: string; last_seen_at: string; raw_json: string },
        []
      >("SELECT description, city, workplace, partial, first_seen_at, last_seen_at, raw_json FROM offers")
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      description: "Plně remote pozice",
      city: "Brno",
      workplace: "remote",
      partial: 0,
      first_seen_at: "2026-10-26T08:00:00.000Z",
      last_seen_at: "2026-10-27T09:30:00.000Z",
    });
    expect(JSON.parse(rows[0]!.raw_json)).toEqual({ id: 1 });

    clock = new Date("2026-10-28T10:00:00Z");
    const failedAgain = raw({ sourceId: "retry-1", partial: true, description: "", city: null, raw: { detailError: "boom" } });
    const retry = await runCollectors(db, [fake("fake", [failedAgain])], now);

    expect(retry[0]).toMatchObject({ status: "ok", fetched: 1, new: 0, updated: 0 });
    const after = db
      .query<{ description: string; city: string | null; last_seen_at: string; raw_json: string }, []>(
        "SELECT description, city, last_seen_at, raw_json FROM offers",
      )
      .all();
    expect(after.length).toBe(1);
    expect(after[0]).toMatchObject({
      description: "Plně remote pozice",
      city: "Brno",
      last_seen_at: "2026-10-28T10:00:00.000Z",
    });
    expect(JSON.parse(after[0]!.raw_json)).toEqual({ id: 1 });
  });

  test("the same source_id twice within one batch is stored once", async () => {
    const dup = raw({ sourceId: "7", title: "Dup" });
    const summaries = await runCollectors(db, [fake("fake", [dup, { ...dup }])], now);

    expect(summaries[0]).toMatchObject({ status: "ok", fetched: 2, new: 1 });
    expect(db.query("SELECT source_id FROM offers").all()).toEqual([{ source_id: "7" }]);
  });

  test("a repost with a different source_id and same title/company/city is not inserted again", async () => {
    const original = raw({ sourceId: "10", title: "AI Engineer", company: "Acme s.r.o.", city: "Praha" });
    const repost = raw({ sourceId: "11", title: "AI engineer", company: "Acme", city: "Praha" });

    const summaries = await runCollectors(db, [fake("fake", [original]), fake("fake", [repost])], now);

    expect(summaries.map((s) => s.new)).toEqual([1, 0]);
    expect(db.query("SELECT source_id FROM offers").all()).toEqual([{ source_id: "10" }]);
  });

  test("offers without a company are not merged by dedup key", async () => {
    const a = raw({ sourceId: "40", title: "Programátor", company: null, city: null });
    const b = raw({ sourceId: "41", title: "Programátor", company: null, city: null });

    const summaries = await runCollectors(db, [fake("fake", [a, b])], now);

    expect(summaries[0]).toMatchObject({ status: "ok", fetched: 2, new: 2 });
    expect(db.query("SELECT source_id FROM offers ORDER BY source_id").all()).toEqual([
      { source_id: "40" },
      { source_id: "41" },
    ]);
  });

  test("rule labels are stored with origin 'rule' and set workplace", async () => {
    const offer = raw({
      sourceId: "20",
      city: "Brno",
      tags: ["Práce převážně z domova"],
      description: "Nabízíme HPP i IČO spolupráci",
    });

    await runCollectors(db, [fake("fake", [offer])], now);

    const labels = db
      .query(
        `SELECT l.label, l.origin FROM offer_labels l JOIN offers o ON o.id = l.offer_id
         WHERE o.source_id = '20' ORDER BY l.label`,
      )
      .all();
    expect(labels).toEqual([
      { label: "hpp", origin: "rule" },
      { label: "ico", origin: "rule" },
      { label: "remote", origin: "rule" },
    ]);
    expect(db.query("SELECT workplace FROM offers WHERE source_id = '20'").get()).toEqual({ workplace: "remote" });
  });

  test("stores the partial flag", async () => {
    const partial = raw({ sourceId: "40", title: "Partial AI", partial: true });
    const full = raw({ sourceId: "41", title: "Full AI" });

    await runCollectors(db, [fake("fake", [partial, full])], now);

    const rows = db.query("SELECT source_id, partial FROM offers ORDER BY source_id").all();
    expect(rows).toEqual([
      { source_id: "40", partial: 1 },
      { source_id: "41", partial: 0 },
    ]);
  });

  test("a run counts partial offers and detail errors, independently", async () => {
    await runCollectors(
      db,
      [fake("fake", [raw({ sourceId: "r0", title: "Already known", partial: true, raw: { detailError: "HTTP 500" } })])],
      now,
    );
    const offers = [
      raw({ sourceId: "r0", title: "Already known", partial: true, raw: { detailError: "HTTP 500" } }),
      raw({ sourceId: "r1", title: "Partial with error", partial: true, raw: { detailError: "HTTP 503" } }),
      raw({ sourceId: "r2", title: "Partial, empty error", partial: true, raw: { detailError: "" } }),
      raw({ sourceId: "r3", title: "Full with error", partial: false, raw: { detailError: "timeout" } }),
      raw({ sourceId: "r4", title: "Full clean", partial: false, raw: { id: 4 } }),
    ];

    const summaries = await runCollectors(db, [fake("fake", offers)], now);

    expect(summaries[0]).toMatchObject({ status: "ok", fetched: 5, new: 4, partial: 2, detailErrors: 2 });
    expect(db.query("SELECT partial, detail_errors, fetched, new FROM runs ORDER BY id DESC LIMIT 1").get()).toEqual({
      partial: 2,
      detail_errors: 2,
      fetched: 5,
      new: 4,
    });
  });
  test("a store failure rolls back the whole collector batch and records the error", async () => {
    const valid = raw({ sourceId: "30", title: "Valid" });
    const broken = raw({ sourceId: null as unknown as string, title: "Broken" });

    const summaries = await runCollectors(db, [fake("fake", [valid, broken])], now);

    expect(summaries[0]).toMatchObject({ status: "error", fetched: 2, new: 0 });
    expect(summaries[0]?.error).toContain("NOT NULL");
    expect(db.query("SELECT COUNT(*) AS n FROM offers").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM offer_labels").get()).toEqual({ n: 0 });
  });
});
