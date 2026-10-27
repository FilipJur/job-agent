import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { buildDigest, renderDigest, tabOf } from "../src/digest/build";
import { headerTitle, pushDigest } from "../src/digest/push";
import { readSince, runDigest } from "../src/digest/run";
import { upsertApplication } from "../src/repo";
import { saveProposal, type StoredProposal } from "../src/tune/proposals";

let db: Database;
let dir: string;
let seq = 0;
const env = { profile: process.env.PROFILE_PATH, proposals: process.env.PROPOSALS_DIR };

beforeEach(() => {
  db = openDb(":memory:");
  seq = 0;
  dir = mkdtempSync(join(tmpdir(), "digest-"));
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

const NOW = "2026-10-27T07:00:00.000Z";
const SINCE = "2026-10-26T07:00:00.000Z";

function offer(over: { labels?: string[]; firstSeenAt?: string; title?: string; company?: string } = {}): number {
  seq += 1;
  const { labels = ["hpp"], firstSeenAt = "2026-10-26T12:00:00.000Z", title = `Offer ${seq}`, company = "Acme" } = over;
  const row = db
    .query<{ id: number }, [string, string, string, string, string, string]>(
      `INSERT INTO offers (source, source_id, url, title, company, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('t', ?, ?, ?, ?, 'unknown', '', 'k', ?, ?, '{}') RETURNING id`,
    )
    .get(`s${seq}`, `https://o.test/${seq}`, title, company, firstSeenAt, firstSeenAt) as { id: number };
  for (const label of labels) db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'rule')", [row.id, label]);
  return row.id;
}

function scored(offerId: number, score: number, verdict = "fit", at = "2026-10-26T13:00:00.000Z"): void {
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, blocker, direction, scored_at) VALUES (?, ?, 'dobrý důvod', 'g', 'm', 'p1', ?, 'b', 'd', ?)",
    [offerId, score, verdict, at],
  );
}

function agency(name: string, crawledAt: string, open = true): void {
  db.run("INSERT INTO agencies (name, fit, created_at, updated_at) VALUES (?, 5, 't', 't')", [name]);
  db.run(
    "UPDATE agencies SET dev_position_open = ?, position_title = 'FE vývojář', position_url = 'https://a.test/jobs', evidence_quote = 'q', crawled_at = ? WHERE name = ?",
    [open ? 1 : 0, crawledAt, name],
  );
}

const summary = { n: 0, positives: 0, negatives: 0, auc: null, precisionAt5: null, precisionAt10: null, meanPositive: null, meanNegative: null };
function storedProposal(status: StoredProposal["status"] = "pending"): void {
  saveProposal({
    id: "2026-10-26T10-00-00Z", createdAt: "2026-10-26T10:00:00.000Z", status, model: "m",
    rationale: [], changes: [], baseProfile: "CURRENT", profile: "PROPOSED",
    metrics: { current: summary, proposed: summary },
  });
}

describe("selection", () => {
  test("keeps only new fit ≥ 6 offers without a user verdict; blocked and old and low and rated are out; score desc", () => {
    const fresh = offer({ title: "Fresh 8" });
    scored(fresh, 8);
    const freshIco = offer({ labels: ["ico"], title: "Contract 9" });
    scored(freshIco, 9);
    const old = offer({ firstSeenAt: "2026-10-25T12:00:00.000Z", title: "Old" });
    scored(old, 9);
    const low = offer({ title: "Low" });
    scored(low, 5);
    const blocked = offer({ title: "Blocked" });
    scored(blocked, 8, "blocked");
    const rated = offer({ title: "Rated" });
    scored(rated, 9);
    db.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, 'down', NULL, ?)", [rated, NOW]);
    const unrated = offer({ title: "Unrated" });
    scored(unrated, 6);
    const excluded = offer({ labels: ["hpp", "excluded"], title: "Excluded" });
    scored(excluded, 9);
    // Feedback exists but was cleared: counts as unlabeled.
    const cleared = offer({ title: "Cleared" });
    scored(cleared, 7);
    db.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, 'down', NULL, ?)", [cleared, "2026-10-26T14:00:00.000Z"]);
    db.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, 'cleared', NULL, ?)", [cleared, "2026-10-26T15:00:00.000Z"]);

    const d = buildDigest(db, { since: SINCE, now: NOW });
    expect(d.offers.map((o) => o.title)).toEqual(["Contract 9", "Fresh 8", "Cleared", "Unrated"]);
    expect(d.offers.find((o) => o.title === "Contract 9")).toMatchObject({ tab: "Kontrakty", score: 9 });
    expect(d.offers.find((o) => o.title === "Fresh 8")).toMatchObject({ tab: "HPP" });
  });

  test("tabOf follows the UI rule: hpp label (or none) reads as HPP", () => {
    expect(tabOf(["hpp"])).toBe("HPP");
    expect(tabOf(["hpp", "ico"])).toBe("HPP");
    expect(tabOf([])).toBe("HPP");
    expect(tabOf(["ico"])).toBe("Kontrakty");
  });
});

describe("agencies and waiting", () => {
  test("only freshly crawled open positions; pending proposal shows, triage backlog counts", () => {
    agency("Fresh", "2026-10-26T12:00:00.000Z");
    agency("Stale", "2026-10-20T12:00:00.000Z");
    agency("Closed", "2026-10-26T12:00:00.000Z", false);
    storedProposal();
    offer(); // unlabelled → triage backlog

    const d = buildDigest(db, { since: SINCE, now: NOW });
    expect(d.agencies.map((a) => a.name)).toEqual(["Fresh"]);
    expect(d.agencies[0]).toMatchObject({ positionTitle: "FE vývojář", positionUrl: "https://a.test/jobs" });
    expect(d.proposalPending).toBe(true);
    expect(d.triageRemaining).toBe(1);
  });

  test("stale proposal does not block the waiting section", () => {
    storedProposal();
    writeFileSync(process.env.PROFILE_PATH!, "EDITED BY HAND");
    expect(buildDigest(db, { since: SINCE, now: NOW }).proposalPending).toBe(false);
  });
});

describe("render", () => {
  test("empty digest says Nic nového; short stays within 300 chars", () => {
    const rendered = renderDigest(buildDigest(db, { since: SINCE, now: NOW }));
    expect(rendered.markdown).toContain("Nic nového");
    expect(rendered.short.length).toBeLessThanOrEqual(300);
    expect(rendered.title).toBe("Ranní přehled – 27. 10. 2026");
  });

  test("sections appear only when non-empty", () => {
    storedProposal();
    const id = offer({ company: "Clientelo" });
    scored(id, 8);
    const rendered = renderDigest(buildDigest(db, { since: SINCE, now: NOW }));
    expect(rendered.markdown).toContain("## Nové k akci (1)");
    expect(rendered.markdown).not.toContain("## Agentury");
    expect(rendered.markdown).toContain("návrh profilu");
    expect(rendered.short).toContain("Clientelo");
  });
});

describe("since", () => {
  test("last.json wins over the 24 h fallback; corrupt file falls back", () => {
    const now = new Date(NOW);
    expect(readSince(dir, now)).toBe(new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
    writeFileSync(join(dir, "last.json"), JSON.stringify({ now: "2026-10-20T00:00:00.000Z" }));
    expect(readSince(dir, now)).toBe("2026-10-20T00:00:00.000Z");
    writeFileSync(join(dir, "last.json"), "not json");
    expect(readSince(dir, now)).toBe(new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
  });

  test("runDigest writes markdown and last.json; dry-run writes nothing", async () => {
    const id = offer({ company: "Clientelo" });
    scored(id, 8);
    const out = join(dir, "digest");
    const res = await runDigest({ db, now: new Date(NOW), digestDir: out });
    expect(res.wrote).toBe(true);
    expect(readFileSync(join(out, "2026-10-27.md"), "utf8")).toContain("Clientelo");
    expect(JSON.parse(readFileSync(join(out, "last.json"), "utf8"))).toEqual({ now: NOW });

    const dry = await runDigest({ db, now: new Date(NOW), digestDir: join(dir, "dry"), dryRun: true });
    expect(dry.wrote).toBe(false);
    expect(dry.markdown).toContain("Clientelo");
  });
});

describe("push", () => {
  test("title folds to ASCII for the header", () => {
    expect(headerTitle("Ranní přehled – 27. 10. 2026")).toBe("Ranni prehled - 27. 10. 2026");
  });

  test("pushes only with a URL; failure never throws and redacts the URL", async () => {
    const seen: { title: string | null; click: string | null }[] = [];
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      seen.push({ title: init?.headers?.Title ?? null, click: init?.headers?.Click ?? null });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await runDigest({ db, now: new Date(NOW), digestDir: dir, ntfyUrl: "https://ntfy.sh/secret", jobAgentUrl: "http://mac:3000", fetchFn });
    expect(res.pushed).toBe(true);
    expect(seen).toEqual([{ title: "Ranni prehled - 27. 10. 2026", click: "http://mac:3000" }]);

    const none = await runDigest({ db, now: new Date(NOW), digestDir: dir });
    expect(none.pushed).toBe(false);

    const failing = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(String(a[0])); };
    try {
      const bad = await runDigest({ db, now: new Date(NOW), digestDir: dir, ntfyUrl: "https://ntfy.sh/secret", fetchFn: failing });
      expect(bad.pushed).toBe(false);
    } finally {
      console.error = orig;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("boom");
    expect(errors[0]).not.toContain("ntfy.sh/secret");

    expect(await pushDigest({ url: "https://x", title: "t", body: "b", fetchFn: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch })).toEqual({
      ok: false, error: "ntfy answered 500",
    });
  });
});

describe("follow-ups", () => {
  test("only applied/interview applications whose next action is due, most overdue first", () => {
    const overdue = offer({ title: "Overdue" });
    const justDue = offer({ title: "Just due" });
    const later = offer({ title: "Later" });
    const rejected = offer({ title: "Rejected" });
    const drafting = offer({ title: "Drafting" });
    upsertApplication(db, overdue, { stage: "applied", nextActionAt: "2026-10-25T07:00:00.000Z" });
    upsertApplication(db, justDue, { stage: "interview", nextActionAt: NOW });
    upsertApplication(db, later, { stage: "applied", nextActionAt: "2026-11-01T07:00:00.000Z" });
    upsertApplication(db, rejected, { stage: "rejected", nextActionAt: "2026-10-25T07:00:00.000Z" });
    upsertApplication(db, drafting, { stage: "drafting", nextActionAt: "2026-10-25T07:00:00.000Z" });

    const d = buildDigest(db, { since: SINCE, now: NOW });
    expect(d.followUps).toEqual([
      {
        offerId: overdue,
        title: "Overdue",
        company: "Acme",
        stage: "applied",
        nextActionAt: "2026-10-25T07:00:00.000Z",
        daysOverdue: 2,
      },
      {
        offerId: justDue,
        title: "Just due",
        company: "Acme",
        stage: "interview",
        nextActionAt: NOW,
        daysOverdue: 0,
      },
    ]);
    const markdown = renderDigest(d).markdown;
    expect(markdown).toContain("## Follow-upy (2)");
    expect(markdown).toContain("Overdue** – Acme · odesláno · 2 dny po termínu");
    expect(markdown).toContain("Just due** – Acme · pohovor · dnes");
  });
});
