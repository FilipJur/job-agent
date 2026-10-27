import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { countOffersToScore, listAgencies, listAspirations, listOffers, offersToScore, saveAgencyCrawl, saveFeedback, saveScore, seedAgencies, updateAgency } from "../src/repo";

let db: Database;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  seq = 0;
});

afterEach(() => {
  db.close();
});

function offer(over: { labels?: string[]; workplace?: string; firstSeenAt?: string; title?: string } = {}): number {
  seq += 1;
  const { labels = [], workplace = "unknown", firstSeenAt = "2026-10-26T10:00:00.000Z", title = `Offer ${seq}` } = over;
  const row = db
    .query<{ id: number }, [string, string, string, string, string]>(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('t', ?, 'https://example.com/', ?, ?, '', 'k', ?, ?, '{}') RETURNING id`,
    )
    .get(`s${seq}`, title, workplace, firstSeenAt, firstSeenAt) as { id: number };
  for (const label of labels) db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'rule')", [row.id, label]);
  return row.id;
}

function scored(offerId: number, score: number, at: string, profileHash = "p1"): void {
  scoredVerdict(offerId, "fit", score, at, profileHash);
}

function scoredVerdict(offerId: number, verdict: string, score: number, at: string, profileHash = "p1"): void {
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, blocker, direction, scored_at) VALUES (?, ?, 'r', 'g', 'm', ?, ?, 'b', 'd', ?)",
    [offerId, score, profileHash, verdict, at],
  );
}

function scoredBlocked(offerId: number, blocker: string, at = "2026-10-26T11:00:00.000Z"): void {
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, blocker, direction, scored_at) VALUES (?, 3, 'r', 'g', 'm', 'p1', 'blocked', ?, '', ?)",
    [offerId, blocker, at],
  );
}

function scoredAspiration(offerId: number, direction: string, at = "2026-10-26T11:00:00.000Z"): void {
  db.run(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, blocker, direction, scored_at) VALUES (?, 8, 'r', 'g', 'm', 'p1', 'aspiration', 'b', ?, ?)",
    [offerId, direction, at],
  );
}

function verdict(offerId: number, v: string, at: string): void {
  db.run("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, ?, NULL, ?)", [offerId, v, at]);
}

const ids = (rows: { id: number }[]): number[] => rows.map((r) => r.id);

describe("listOffers tabs", () => {
  test("hpp takes hpp-labelled and form-less offers, kontrakty takes ico/freelance/dpp-dpc, excluded appears in neither", () => {
    const a = offer({ labels: ["hpp"] });
    const b = offer({ labels: ["ico"] });
    const c = offer({ labels: ["hpp", "ico"] });
    const d = offer();
    offer({ labels: ["hpp", "excluded"] });

    expect(ids(listOffers(db, { tab: "hpp" }))).toEqual(expect.arrayContaining([a, c, d]));
    expect(ids(listOffers(db, { tab: "hpp" }))).not.toContain(b);
    expect(ids(listOffers(db, { tab: "kontrakty" }))).toEqual(expect.arrayContaining([b, c]));
    expect(ids(listOffers(db, { tab: "kontrakty" }))).not.toContain(a);
    expect(ids(listOffers(db, { tab: "kontrakty" }))).not.toContain(d);
    expect(listOffers(db, { tab: "hpp" })).toHaveLength(3);
    expect(listOffers(db, { tab: "kontrakty" })).toHaveLength(2);
  });

  test("hidden view lists user-hidden plus model-blocked offers with their reasons", () => {
    const a = offer({ labels: ["hpp"] });
    verdict(a, "hidden", "2026-10-26T11:00:00.000Z");
    const b = offer({ labels: ["hpp"] });
    scoredBlocked(b, "onsite NYC");

    expect(listOffers(db, { tab: "hpp" })).toHaveLength(0);
    const shown = listOffers(db, { tab: "hpp", includeHidden: true });
    expect(ids(shown)).toEqual(expect.arrayContaining([a, b]));
    expect(shown.find((r) => r.id === a)?.feedback).toMatchObject({ verdict: "hidden" });
    expect(shown.find((r) => r.id === b)?.score).toMatchObject({ verdict: "blocked", blocker: "onsite NYC" });
  });

  test("sort is score desc with unscored last; latest score and feedback rows win", () => {
    const a = offer({ labels: ["hpp"] });
    const c = offer({ labels: ["hpp"] });
    const d = offer({ labels: ["hpp"] });
    const g = offer({ labels: ["hpp"], firstSeenAt: "2026-10-20T10:00:00.000Z" });
    scored(a, 5, "2026-10-26T11:00:00.000Z");
    scored(a, 9, "2026-10-26T12:00:00.000Z");
    scored(c, 7, "2026-10-26T11:00:00.000Z");
    verdict(c, "down", "2026-10-26T11:00:00.000Z");
    verdict(c, "up", "2026-10-26T12:00:00.000Z");

    const rows = listOffers(db, { tab: "hpp" });
    expect(ids(rows)).toEqual([a, c, d, g]);
    expect(rows[0]!.score).toMatchObject({ score: 9 });
    expect(rows[1]!.feedback).toMatchObject({ verdict: "up" });
    expect(rows[2]!.score).toBeNull();
  });

  test("onlyNew, remote and olomouc filters", () => {
    const hour = 60 * 60 * 1000;
    const at = (agoMs: number): string => new Date(Date.now() - agoMs).toISOString();
    const fresh = offer({ labels: ["hpp"], firstSeenAt: at(hour) });
    const old = offer({ labels: ["hpp"], firstSeenAt: at(48 * hour) });
    const remote = offer({ workplace: "remote" });
    const remoteCz = offer({ labels: ["remote-cz"] });
    const olomouc = offer({ labels: ["olomouc"] });

    expect(ids(listOffers(db, { tab: "hpp", onlyNew: true }))).toEqual(expect.arrayContaining([fresh]));
    expect(ids(listOffers(db, { tab: "hpp", onlyNew: true }))).not.toContain(old);
    expect(ids(listOffers(db, { tab: "hpp", remote: true }))).toEqual(expect.arrayContaining([remote, remoteCz]));
    expect(ids(listOffers(db, { tab: "hpp", remote: true }))).not.toContain(fresh);
    expect(ids(listOffers(db, { tab: "hpp", olomouc: true }))).toEqual([olomouc]);
  });
});

describe("offersToScore", () => {
  test("skips excluded and already-scored offers; a score with another profile hash does not count; limit caps", () => {
    const scoredSame = offer({ title: "same" });
    const scoredOther = offer({ title: "other", firstSeenAt: "2026-10-26T11:00:00.000Z" });
    offer({ title: "excluded", labels: ["excluded"] });
    offer({ title: "fresh", firstSeenAt: "2026-10-26T12:00:00.000Z" });
    scored(scoredSame, 8, "2026-10-26T11:00:00.000Z", "p1");
    scored(scoredOther, 8, "2026-10-26T11:00:00.000Z", "p2");

    expect(offersToScore(db, { profileHash: "p1" }).map((o) => o.title)).toEqual(["fresh", "other"]);
    expect(offersToScore(db, { profileHash: "p1", limit: 1 }).map((o) => o.title)).toEqual(["fresh"]);
    expect(offersToScore(db, { profileHash: "p1" }).find((o) => o.title === "excluded")).toBeUndefined();
  });

  test("countOffersToScore matches offersToScore length with and without existing scores", () => {
    const a = offer();
    offer();
    offer({ labels: ["excluded"] });
    expect(countOffersToScore(db, "p1")).toBe(offersToScore(db, { profileHash: "p1" }).length);
    scored(a, 5, "2026-10-26T11:00:00.000Z", "p1");
    expect(countOffersToScore(db, "p1")).toBe(1);
    expect(countOffersToScore(db, "p1")).toBe(offersToScore(db, { profileHash: "p1" }).length);
  });

  test("saveScore stores the row and llm labels; saveFeedback stores the verdict", () => {
    const id = offer();
    saveScore(db, { offerId: id, score: 7.5, reason: "r", gaps: "g", model: "m", profileHash: "p1", scoredAt: "2026-10-26T11:00:00.000Z", labels: ["ai-first"], verdict: "fit", blocker: "", direction: "" });
    saveFeedback(db, id, "up", "good");

    const rows = listOffers(db, { tab: "hpp" });
    expect(rows[0]!.score).toMatchObject({ score: 7.5, reason: "r", gaps: "g", model: "m", verdict: "fit", blocker: "", direction: "" });
    expect(rows[0]!.feedback).toMatchObject({ verdict: "up", reason: "good" });
    expect(rows[0]!.labels).toContain("ai-first");
    expect(offersToScore(db, { profileHash: "p1" })).toHaveLength(0);
  });

  test("blocked offers are hidden until a newer fit score replaces them", () => {
    const id = offer();
    saveScore(db, { offerId: id, score: 3, reason: "r", gaps: "g", model: "m", profileHash: "p1", scoredAt: "2026-10-26T11:00:00.000Z", verdict: "blocked", blocker: "onsite NYC", direction: "" });
    expect(listOffers(db, { tab: "hpp" })).toHaveLength(0);
    saveScore(db, { offerId: id, score: 8, reason: "r", gaps: "g", model: "m", profileHash: "p1", scoredAt: "2026-10-26T12:00:00.000Z", verdict: "fit", blocker: "", direction: "" });
    expect(listOffers(db, { tab: "hpp" })).toHaveLength(1);
  });
});

describe("effective offer state", () => {
  const tabOf = (id: number): "tab" | "hidden" | "aspirations" | "nowhere" => {
    const places = [
      listOffers(db, { tab: "hpp" }).some((r) => r.id === id) && "tab",
      listOffers(db, { tab: "hpp", includeHidden: true }).some((r) => r.id === id) && "hidden",
      listAspirations(db).some((r) => r.id === id) && "aspirations",
    ].filter((p) => p !== false);
    // Exactly one placement must hold.
    return places.length === 1 ? (places[0] as "tab" | "hidden" | "aspirations") : "nowhere";
  };

  test("model verdict × user verdict placement, including clear restoring the model placement", () => {
    // Model × user combinations; null = no user verdict.
    const cases: { model: "fit" | "blocked" | "aspiration" | null; user: string | null; want: "tab" | "hidden" | "aspirations" }[] = [
      { model: null, user: null, want: "tab" },
      { model: "fit", user: null, want: "tab" },
      { model: "blocked", user: null, want: "hidden" },
      { model: "aspiration", user: null, want: "aspirations" },
      { model: "blocked", user: "up", want: "tab" },
      { model: "blocked", user: "down", want: "tab" },
      { model: "blocked", user: "responded", want: "tab" },
      { model: "aspiration", user: "down", want: "tab" },
      { model: "fit", user: "hidden", want: "hidden" },
      { model: "aspiration", user: "hidden", want: "hidden" },
      { model: "blocked", user: "hidden", want: "hidden" },
      { model: "fit", user: "aspiration", want: "aspirations" },
      { model: "blocked", user: "aspiration", want: "aspirations" },
    ];
    for (const [i, c] of cases.entries()) {
      const id = offer({ labels: ["hpp"], title: `Offer ${i}` });
      if (c.model === "fit") scoredVerdict(id, "fit", 7, "2026-10-26T11:00:00.000Z");
      if (c.model === "blocked") scoredBlocked(id, "onsite NYC");
      if (c.model === "aspiration") scoredAspiration(id, "learn X");
      if (c.user !== null) verdict(id, c.user, "2026-10-26T12:00:00.000Z");
      expect({ model: c.model, user: c.user, got: tabOf(id) }).toMatchObject({ model: c.model, user: c.user, got: c.want });
    }

    // Clearing restores the model placement: a blocked offer returns to Skryté, a fit one to the tab.
    const cleared = offer({ labels: ["hpp"], title: "cleared" });
    scoredBlocked(cleared, "onsite NYC");
    verdict(cleared, "up", "2026-10-26T12:00:00.000Z");
    expect(tabOf(cleared)).toBe("tab");
    saveFeedback(db, cleared, "cleared");
    expect(tabOf(cleared)).toBe("hidden");
    const clearedRow = listOffers(db, { tab: "hpp", includeHidden: true }).find((r) => r.id === cleared);
    expect(clearedRow?.feedback).toBeNull();

    // Aspiration rows carry their source.
    const ai = offer({ labels: ["hpp"], title: "ai-asp" });
    scoredAspiration(ai, "learn X");
    const mine = offer({ labels: ["hpp"], title: "my-asp" });
    scoredBlocked(mine, "onsite NYC");
    saveFeedback(db, mine, "aspiration");
    expect(listAspirations(db).find((r) => r.id === mine)).toMatchObject({ source: "user", blocker: "onsite NYC" });
  });
});

describe("agencies", () => {
  const items = [
    { name: "Beta", web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 5 },
    { name: "Alpha", web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 5 },
    { name: "Gamma", web: null, city: null, focus: null, stack: null, signal: null, email: null, phone: null, fit: 3 },
  ];

  test("lists seed fit desc then name; update edits status/notes/contact; reseed keeps edits", () => {
    expect(seedAgencies(db, items)).toEqual({ inserted: 3, updated: 0, skipped: 0 });
    expect(listAgencies(db).map((a) => a.name)).toEqual(["Alpha", "Beta", "Gamma"]);

    const beta = listAgencies(db).find((a) => a.name === "Beta")!;
    const updated = updateAgency(db, beta.id, { status: "contacted", notes: "called", lastContactAt: "2026-10-26" });
    expect(updated).toMatchObject({ status: "contacted", notes: "called", lastContactAt: "2026-10-26" });

    expect(seedAgencies(db, items)).toEqual({ inserted: 0, updated: 0, skipped: 3 });
    expect(listAgencies(db).find((a) => a.name === "Beta")).toMatchObject({ status: "contacted", notes: "called" });

    // Open dev position beats seed fit; a stated dev rate beats no rate.
    const crawl = { positionTitle: null, positionUrl: null, evidenceQuote: null, form: null, devRate: null, remoteOrOlomouc: false, aiFit: null, aiReason: null, crawledAt: "t" };
    const ids = Object.fromEntries(listAgencies(db).map((a) => [a.name, a.id]));
    saveAgencyCrawl(db, ids.Gamma!, {
      ...crawl, devPositionOpen: true, positionTitle: "WP dev", positionUrl: "https://g.test/k",
      evidenceQuote: "Hledáme WP vývojáře.", form: "hpp", aiFit: 3, aiReason: "r",
    });
    saveAgencyCrawl(db, ids.Beta!, { ...crawl, devPositionOpen: false, form: "ico", devRate: "600 Kč/h" });
    expect(listAgencies(db).map((a) => a.name)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(listAgencies(db)[0]).toMatchObject({ devPositionOpen: true, evidenceQuote: "Hledáme WP vývojáře." });
  });

  test("reseed refreshes research fields only and keeps status, notes and last contact", () => {
    seedAgencies(db, items);
    const beta = listAgencies(db).find((a) => a.name === "Beta")!;
    updateAgency(db, beta.id, { status: "replied", notes: "n", lastContactAt: "2026-10-26" });

    const changed = items.map((a) => (a.name === "Beta" ? { ...a, contact_url: "https://beta.test/kontakt", email: "x@beta.test", focus: "new focus" } : a));
    expect(seedAgencies(db, changed)).toEqual({ inserted: 0, updated: 1, skipped: 2 });
    expect(listAgencies(db).find((a) => a.name === "Beta")).toMatchObject({
      contactUrl: "https://beta.test/kontakt",
      email: "x@beta.test",
      focus: "new focus",
      status: "replied",
      notes: "n",
      lastContactAt: "2026-10-26",
    });
  });
});
