import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { marketConfig } from "../src/market/config";
import { formOf, offerRate, placeOf, type RateInput } from "../src/market/rates";
import { type MarketReport, marketReport, percentile } from "../src/market/report";
import { skillStats, strengthsSection } from "../src/market/skills";

const base: RateInput = { source: "jobscz", salaryMin: null, salaryMax: null, currency: null, rawJson: "{}", description: "" };
const ashbyYearly = JSON.stringify({
  compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR" }] },
});

describe("offerRate", () => {
  test.each([
    ["monthly CZK midpoint", { salaryMin: 64000, salaryMax: 96000, currency: "CZK" }, { czkPerHour: 500, basis: "salary" }],
    ["monthly CZK, max only", { source: "startupjobs", salaryMax: 120000, currency: "CZK" }, { czkPerHour: 750, basis: "salary" }],
    ["yearly EUR (ashby interval)", { source: "ashby", salaryMin: 76800, currency: "EUR", rawJson: ashbyYearly }, { czkPerHour: 1000, basis: "salary" }],
    ["text Kč/h", { description: "Sazba 450 Kč/h bez DPH" }, { czkPerHour: 450, basis: "text" }],
    ["text range CZK/hod", { description: "IČO, 500–700 CZK/hod" }, { czkPerHour: 600, basis: "text" }],
    ["text €/h", { description: "Rate: €40/h" }, { czkPerHour: 1000, basis: "text" }],
    ["text EUR per hour", { description: "we pay 40 EUR per hour" }, { czkPerHour: 1000, basis: "text" }],
    ["text € range over two mentions", { description: "from €15/hour up to €30/hour" }, { czkPerHour: 563, basis: "text" }],
    ["implausible salary falls back to text", { salaryMin: 10000, currency: "CZK", description: "nebo 400 Kč/h" }, { czkPerHour: 400, basis: "text" }],
    ["implausibly low salary dropped", { salaryMin: 10000, currency: "CZK" }, null],
    ["implausibly high text dropped", { description: "20 000 Kč/h" }, null],
    ["unknown source period dropped", { source: "hn", salaryMin: 100000, currency: "CZK" }, null],
    ["text USD/hour", { description: "$23-$34 USD/hour" }, { czkPerHour: 621, basis: "text" }],
    ["text GBP/hour", { description: "AI Engineer (£30/hr)" }, { czkPerHour: 873, basis: "text" }],
    ["text EUR/month", { description: "Gross salary range €5000–€6000 per month" }, { czkPerHour: 859, basis: "text" }],
    ["text USD/month", { description: "$3,500-$5,000 USD/month" }, { czkPerHour: 579, basis: "text" }],
    ["text EUR month range", { description: "3,700 EUR - 5,000 EUR / Month" }, { czkPerHour: 680, basis: "text" }],
  ] as const)("%s", (_, patch, expected) => {
    expect(offerRate({ ...base, ...patch }, marketConfig)).toEqual(expected);
  });
});

test("contract labels beat hpp; no form label counts as hpp; place precedence", () => {
  expect(formOf(["hpp", "ico"])).toBe("contract");
  expect(formOf(["dpp-dpc"])).toBe("contract");
  expect(formOf(["praha"])).toBe("hpp");
  expect(placeOf(["okoli-olomouce", "remote"])).toBe("olomouc");
  expect(placeOf(["praha", "remote-cz"])).toBe("remote");
  expect(placeOf(["hybrid"])).toBe("other");
});

test("percentiles interpolate linearly", () => {
  expect([0.25, 0.5, 0.75].map((p) => percentile([100, 200, 300, 400], p))).toEqual([175, 250, 325]);
  expect(percentile([300], 0.25)).toBe(300);
  expect(percentile([], 0.5)).toBeNull();
});

describe("marketReport", () => {
  const cfg = { ...marketConfig, skills: [{ name: "Python", match: ["python"] }, { name: "Java", match: ["java"] }] };

  /** One score row per tuple: [offerId, score, verdict, gaps, scoredAt]; the offer is created on first use. */
  function report(scores: [number, number, "fit" | "blocked", string, string?][]): MarketReport {
    const db = openDb(":memory:");
    for (const [id, score, verdict, gaps, scoredAt = "2026-10-27T10:00:00Z"] of scores) {
      db.run(
        `INSERT OR IGNORE INTO offers (id, source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
         VALUES (?, 'jobscz', ?, 'https://e.x/', 'Dev', 'unknown', '', 'k', 'now', 'now', '{}')`,
        [id, `s${id}`],
      );
      db.run(
        `INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, verdict, scored_at)
         VALUES (?, ?, 'r', ?, 'm', 'h', ?, ?)`,
        [id, score, gaps, verdict, scoredAt],
      );
    }
    return marketReport(db, new Date("2026-10-27T12:00:00Z"), cfg);
  }

  test("leverage counts only near-miss fit offers whose latest gaps name the skill", () => {
    const r = report([
      [1, 2, "fit", "Python"], // below the near-miss band
      [2, 3, "fit", "chybí Python"],
      [3, 6.9, "fit", "python, testy"],
      [4, 7, "fit", "Python"], // already good
      [5, 5, "blocked", "Python"], // blocked by the model
      [6, 5, "fit", "Java"],
    ]);
    expect(r.skills.find((s) => s.skill === "Python")).toMatchObject({ gapMentions: 5, leverage: 2 });
    expect(r.leverage.map((s) => [s.skill, s.leverage])).toEqual([
      ["Python", 2],
      ["Java", 1],
    ]);
  });

  test("only the latest score row of an offer counts", () => {
    const r = report([
      [1, 5, "fit", "Python", "2026-10-20T10:00:00Z"],
      [1, 1, "fit", "Python", "2026-10-21T10:00:00Z"],
    ]);
    expect(r.leverage).toEqual([]);
  });
});

describe("skillStats", () => {
  const skills = [
    { name: "Python", match: ["python"] },
    { name: "React", match: ["react"] },
    { name: "Java", match: ["java"] },
  ];
  const offers = [
    { text: "x", score: 5, verdict: "fit", gaps: "React" },
    { text: "x", score: 5, verdict: "fit", gaps: "Python" },
  ];

  test("owned counts as his: in skills with owned true, never boosted further", () => {
    const stats = skillStats(offers, skills, "## Silné stránky\n- React\n");
    expect(stats.find((s) => s.skill === "React")).toMatchObject({ owned: true, leverage: 1 });
    expect(stats.find((s) => s.skill === "Python")).toMatchObject({ owned: false, leverage: 1 });
  });

  test("czech inflections match; javascriptu does not match java", () => {
    const stats = skillStats(
      [
        { text: "znalost Pythonu výhodou", score: null, verdict: null, gaps: null },
        { text: "znalost javascriptu", score: null, verdict: null, gaps: null },
      ],
      skills,
    );
    expect(stats.find((s) => s.skill === "Python")).toMatchObject({ offers: 1 });
    expect(stats.find((s) => s.skill === "Java")).toMatchObject({ offers: 0 });
  });

  test("strengths section slicing", () => {
    expect(strengthsSection("## Silné stránky\n- React\n## Slabé stránky\n- Python\n")).toContain("React");
    expect(strengthsSection("## Silné stránky\n- React\n## Slabé stránky\n- Python\n")).not.toContain("Python");
    expect(strengthsSection("no headings, whole profile: React")).toContain("React");
  });
});
