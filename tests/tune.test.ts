import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import type { PostJson } from "../src/scoring/client";
import { generateProposal } from "../src/tune/generate";
import { isTuneDue, markTuneAttempt, saveProposal, type StoredProposal } from "../src/tune/proposals";
import { handle } from "../src/web/server";

let db: Database;
let dir: string;
const env = { profile: process.env.PROFILE_PATH, proposals: process.env.PROPOSALS_DIR };

beforeEach(() => {
  db = openDb(":memory:");
  dir = mkdtempSync(join(tmpdir(), "tune-"));
  process.env.PROFILE_PATH = join(dir, "profile.md");
  process.env.PROPOSALS_DIR = join(dir, "proposals");
  writeFileSync(process.env.PROFILE_PATH, "CURRENT");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  for (const [key, value] of [["PROFILE_PATH", env.profile], ["PROPOSALS_DIR", env.proposals]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const profileText = () => readFileSync(process.env.PROFILE_PATH!, "utf8");

describe("proposal routes", () => {
  const summary = { n: 0, positives: 0, negatives: 0, auc: null, precisionAt5: null, precisionAt10: null, meanPositive: null, meanNegative: null };
  const stored = (id: string, status: StoredProposal["status"] = "pending"): void => {
    saveProposal({
      id, createdAt: id, status, model: "m", rationale: [], changes: [],
      baseProfile: "CURRENT", profile: "PROPOSED", metrics: { current: summary, proposed: summary },
    });
  };
  const post = async (path: string) => {
    const res = await handle(new Request(`http://localhost${path}`, { method: "POST" }), db);
    return { status: res.status, body: await res.json() };
  };

  test("apply writes the profile once; a second apply is 409", async () => {
    stored("2026-10-27T10-00-00Z");
    expect(await post("/api/proposals/2026-10-27T10-00-00Z/apply")).toEqual({ status: 200, body: { ok: true } });
    expect(profileText()).toBe("PROPOSED");
    expect((await post("/api/proposals/2026-10-27T10-00-00Z/apply")).status).toBe(409);
    expect((await post("/api/proposals/2026-10-27T10-00-00Z/reject")).status).toBe(409);
  });

  test("a stale proposal is not applied and the profile stays untouched", async () => {
    stored("2026-10-27T10-00-00Z");
    writeFileSync(process.env.PROFILE_PATH!, "EDITED BY HAND");
    const res = await handle(new Request("http://localhost/api/proposals"), db);
    expect((await res.json())[0].stale).toBe(true);
    expect((await post("/api/proposals/2026-10-27T10-00-00Z/apply")).status).toBe(409);
    expect(profileText()).toBe("EDITED BY HAND");
  });

  test("reject marks the proposal; non-pending and unknown ids are refused", async () => {
    stored("2026-10-27T10-00-00Z");
    stored("2026-10-28T10-00-00Z", "discarded");
    expect((await post("/api/proposals/2026-10-27T10-00-00Z/reject")).status).toBe(200);
    expect((await post("/api/proposals/2026-10-27T10-00-00Z/apply")).status).toBe(409);
    expect((await post("/api/proposals/2026-10-28T10-00-00Z/apply")).status).toBe(409);
    expect((await post("/api/proposals/..%2Fprofile/apply")).status).toBe(404);
    const list = await (await handle(new Request("http://localhost/api/proposals"), db)).json();
    expect(list.map((p: StoredProposal) => [p.id, p.status])).toEqual([
      ["2026-10-28T10-00-00Z", "discarded"],
      ["2026-10-27T10-00-00Z", "rejected"],
    ]);
    expect(profileText()).toBe("CURRENT");
  });
});

describe("generateProposal", () => {
  function label(title: string, verdict: string): void {
    const id = db
      .query<{ id: number }, [string, string, string]>(
        `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
         VALUES ('t', ?, 'https://example.com/', ?, 'unknown', 'popis', ?, '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '{}')
         RETURNING id`,
      )
      .get(title, title, title)!.id;
    db.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, ?, 'důvod', '2026-10-26T10:00:00.000Z')", [id, verdict]);
  }

  const reply = (payload: unknown) => ({
    status: 200,
    body: JSON.stringify({ output: [{ type: "message", content: [{ text: JSON.stringify(payload) }] }] }),
  });

  /** Current profile: good offers 8, bad 2. Proposed profile: `proposedGood`/`proposedBad`. */
  function fakeApi(proposedGood: number, proposedBad: number): { postJson: PostJson; calls: () => number } {
    let calls = 0;
    const postJson: PostJson = async (_url, body) => {
      calls += 1;
      const b = body as { text?: { format?: { name?: string } }; input: { content: { text: string }[] }[] };
      if (b.text?.format?.name === "profile_proposal") return reply({ profile: "PROPOSED", rationale: ["r"], changes: ["c"] });
      const text = b.input[0]!.content[0]!.text;
      const good = text.includes("Název: good");
      const score = text.startsWith("PROPOSED") ? (good ? proposedGood : proposedBad) : good ? 8 : 2;
      return reply({ verdict: "fit", score, reason: "r", gaps: "", blocker: "", direction: "", labels: [] });
    };
    return { postJson, calls: () => calls };
  }

  const run = (postJson: PostJson) =>
    generateProposal(db, {
      profile: "CURRENT", model: "m", endpoint: "e", maxDescriptionChars: 100, apiKey: "k", sessionId: "s", postJson,
      now: () => new Date("2026-10-27T10:00:00.000Z"),
    });

  const labelSet = (good: number, bad: number) => {
    for (let i = 0; i < good; i += 1) label(`good ${i}`, "up");
    for (let i = 0; i < bad; i += 1) label(`bad ${i}`, "down");
  };

  test("not enough labels: no LLM call and no file", async () => {
    labelSet(8, 2);
    const api = fakeApi(8, 2);
    expect((await run(api.postJson)).kind).toBe("not-enough-labels");
    expect(api.calls()).toBe(0);
    expect(existsSync(process.env.PROPOSALS_DIR!)).toBe(false);
    expect(isTuneDue(Date.parse("2026-10-27T10:00:00.000Z"))).toBe(true);
  });

  test("a run past the label check marks the attempt even when the API fails", async () => {
    labelSet(6, 6);
    const failing: PostJson = async () => {
      throw new Error("boom");
    };
    await expect(run(failing)).rejects.toThrow("boom");
    expect(isTuneDue(Date.parse("2026-10-27T10:00:00.000Z"))).toBe(false);
    expect(JSON.parse(readFileSync(join(process.env.PROPOSALS_DIR!, "last-attempt.json"), "utf8"))).toEqual({
      at: "2026-10-27T10:00:00.000Z",
    });
  });

  test.each([
    ["discarded", 3, 7],
    ["pending", 9, 1],
  ] as const)("proposal is %s when its replay AUC is lower / not lower", async (status, good, bad) => {
    labelSet(6, 6);
    const result = await run(fakeApi(good, bad).postJson);
    if (result.kind !== "created") throw new Error(result.kind);
    expect(result.proposal.status).toBe(status);
    expect(JSON.parse(readFileSync(result.path, "utf8")).status).toBe(status);
    expect(readdirSync(process.env.PROPOSALS_DIR!).filter((f) => f !== "last-attempt.json")).toEqual(["2026-10-27T10-00-00Z.json"]);
  });

  test("hold-out: the prompt shows training scores and disagreements, never held-out ids", async () => {
    for (let i = 0; i < 30; i += 1) label(`offer ${i}`, i < 15 ? "up" : "down");
    const ids = db.query<{ id: number }, []>("SELECT id FROM offers ORDER BY id").all().map((r) => r.id);
    const held = new Set(ids.filter((id) => id % 3 === 0));
    expect(held.size).toBe(10);
    let prompt = "";
    const scored = new Set<number>();
    const idOfTitle = new Map(ids.map((id, i) => [`offer ${i}`, id]));
    const postJson: PostJson = async (_url, body) => {
      const b = body as { text?: { format?: { name?: string } }; input: { content: { text: string }[] }[] };
      if (b.text?.format?.name === "profile_proposal") {
        prompt = b.input[0]!.content[0]!.text;
        return reply({ profile: "PROPOSED", rationale: ["r"], changes: ["c"] });
      }
      const text = b.input[0]!.content[0]!.text;
      const title = text.split("\n").find((l) => l.startsWith("Název: "))!.slice("Název: ".length);
      scored.add(idOfTitle.get(title)!);
      const good = Number(title.split(" ")[1]!) < 15;
      // Current profile mis-scores one training positive low and one training negative high,
      // so the prompt carries a non-empty disagreement section.
      const current = title === "offer 1" ? 2 : title === "offer 16" ? 8 : good ? 8 : 2;
      const score = text.startsWith("PROPOSED") ? (good ? 9 : 1) : current;
      return reply({ verdict: "fit", score, reason: `důvod ${title}`, gaps: "", blocker: "", direction: "", labels: [] });
    };
    const result = await run(postJson);
    if (result.kind !== "created") throw new Error(result.kind);
    expect(result.proposal.evaluation).toEqual({ kind: "holdout", n: held.size });
    for (const id of held) expect(prompt).not.toContain(`#${id} `);
    // Every training offer is printed with its replayed model score; nothing is unscored.
    expect(prompt).not.toContain("model: neohodnoceno");
    expect(prompt).toContain("model: skóre 2, verdikt fit; důvod: důvod offer 1");
    expect(prompt).toContain("model: skóre 8, verdikt fit; důvod: důvod offer 16");
    expect(prompt).toMatch(/=== NEJHORŠÍ NESHODY ===\n#\d+ offer (1|16): uživatel/);
    expect(prompt).not.toContain("=== NEJHORŠÍ NESHODY ===\nžádné");
    // Metrics still measure only the hold-out; replays covered it plus all 20 training offers.
    expect([...scored].filter((id) => held.has(id))).toHaveLength(held.size);
    expect([...scored].filter((id) => !held.has(id))).toHaveLength(ids.length - held.size);
  });

  test("below the hold-out threshold: in-sample with an honest flag", async () => {
    labelSet(6, 6);
    const result = await run(fakeApi(9, 1).postJson);
    if (result.kind !== "created") throw new Error(result.kind);
    expect(result.proposal.evaluation).toEqual({ kind: "in-sample", n: 12 });
  });
});

describe("tune cadence", () => {
  const DAY = 24 * 3600 * 1000;
  const now = Date.parse("2026-10-27T10:00:00.000Z");

  test("an attempt counts for 7 days even with no proposal file", () => {
    expect(isTuneDue(now)).toBe(true);
    markTuneAttempt(now);
    expect(isTuneDue(now + 6 * DAY)).toBe(false);
    expect(isTuneDue(now + 7 * DAY)).toBe(true);
    expect(JSON.parse(readFileSync(join(process.env.PROPOSALS_DIR!, "last-attempt.json"), "utf8"))).toEqual({
      at: "2026-10-27T10:00:00.000Z",
    });
    expect(readdirSync(process.env.PROPOSALS_DIR!).filter((f) => f.endsWith(".json") && f !== "last-attempt.json")).toEqual([]);
  });

  test("a newer proposal still resets the clock", () => {
    markTuneAttempt(now - 10 * DAY);
    expect(isTuneDue(now)).toBe(true);
    saveProposal({
      id: "2026-10-27T10-00-00Z",
      createdAt: "2026-10-27T10:00:00.000Z",
      status: "discarded",
      model: "m",
      rationale: [],
      changes: [],
      baseProfile: "CURRENT",
      profile: "PROPOSED",
      metrics: {
        current: { n: 0, positives: 0, negatives: 0, auc: null, precisionAt5: null, precisionAt10: null, meanPositive: null, meanNegative: null },
        proposed: { n: 0, positives: 0, negatives: 0, auc: null, precisionAt5: null, precisionAt10: null, meanPositive: null, meanNegative: null },
      },
    });
    expect(isTuneDue(now + 6 * DAY)).toBe(false);
    expect(isTuneDue(now + 7 * DAY)).toBe(true);
  });
});
