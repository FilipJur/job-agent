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
    ["bare $200K-$250K yearly range", { description: "Compensation: $200K–$250K + equity" }, { czkPerHour: 2555, basis: "text" }],
    ["bare $12K project fee dropped", { description: "Fixed-fee project ($12K, milestone-based)" }, null],
    ["CAD range skipped, USD range kept", { description: "$185K–$220K USD / $155K–$185K CAD" }, { czkPerHour: 2299, basis: "text" }],
    ["C$ amount is not USD", { description: "Salary C$180K" }, null],
    ["equity /yr is not salary", { description: "up to $380,895/yr Performance Share Units and $273,628/yr PSUs" }, null],
    ["benefit /yr is not salary", { description: "Learning allowance of $9,000/yr" }, null],
    ["salary /yr + benefits still counts", { description: "$150,000/yr + benefits" }, { czkPerHour: 1703, basis: "text" }],
    ["budget range counts as yearly", { description: "$134,450–$167,258 total budget (COL-adjusted)" }, { czkPerHour: 1713, basis: "text" }],
    ["single budget amount ignored", { description: "$50,000 budget for the project" }, null],
    [
      "budget range wins over equity /yr",
      { description: "$134,450–$167,258 total budget. Up to $380,895/yr Performance Share Units" },
      { czkPerHour: 1713, basis: "text" },
    ],
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
  const profile = "## Silné stránky\n- TypeScript\n";

  /** One score row per tuple: [offerId, score, verdict, gaps, scoredAt]; the offer is created on first use. */
  function report(scores: [number, number, "fit" | "blocked", string, string?][], profileText = profile): MarketReport {
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
    return marketReport(db, new Date("2026-10-27T12:00:00Z"), cfg, profileText);
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

  test("an owned skill never appears in leverage, but stays in skills", () => {
    const r = report(
      [
        [1, 5, "fit", "Python"],
        [2, 5, "fit", "Java"],
      ],
      "## Silné stránky\n- Python\n## Slabé stránky\n- Java\n",
    );
    expect(r.skills.find((s) => s.skill === "Python")).toMatchObject({ owned: true, leverage: 1 });
    expect(r.leverage.map((s) => s.skill)).toEqual(["Java"]);
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

  test("jest does not match the Czech word ještě", () => {
    const stats = skillStats(
      [
        { text: "ještě jedna pozice", score: null, verdict: null, gaps: null },
        { text: "unit tests in Jest", score: null, verdict: null, gaps: null },
      ],
      [{ name: "Testing", match: ["jest"] }],
    );
    expect(stats[0]).toMatchObject({ offers: 1 });
  });

  test("strengths section slicing", () => {
    expect(strengthsSection("## Silné stránky\n- React\n## Slabé stránky\n- Python\n")).toContain("React");
    expect(strengthsSection("## Silné stránky\n- React\n## Slabé stránky\n- Python\n")).not.toContain("Python");
    expect(strengthsSection("no headings, whole profile: React")).toContain("React");
  });
});
