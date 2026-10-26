import { describe, expect, test } from "bun:test";
import { createAshbyCollector } from "../src/collectors/ashby";
import { isRelevant, parseBoard, type AshbyJob } from "../src/collectors/ashby/parse";
import type { Collector, FetchText } from "../src/types";

const fixture = (name: string) =>
  Bun.file(new URL(`./fixtures/ashby/${name}.json`, import.meta.url)).text();

const [apify, rohlik, checkly] = await Promise.all([fixture("apify"), fixture("rohlik"), fixture("checkly")]);
const bodies: Record<string, string> = { apify, rohlik, checkly };

describe("ashby board parsing", () => {
  test("maps one job to a RawOffer and trims the long description fields from raw", () => {
    const offers = parseBoard(apify, "Apify");
    expect(offers.length).toBe(3);
    const ai = offers.find((o) => o.title === "AI Engineer");
    expect(ai).toMatchObject({
      source: "ashby",
      sourceId: "1dbcda58-3795-4d4c-a5f8-83b515599e03",
      url: "https://jobs.ashbyhq.com/apify/1dbcda58-3795-4d4c-a5f8-83b515599e03",
      company: "Apify",
      locationText: "Prague",
      city: "Prague",
      salaryMin: null,
      salaryMax: null,
      currency: null,
      publishedAt: "2026-07-27T09:51:25.634+00:00",
      partial: false,
    });
    expect(ai?.tags).toEqual(["hybrid work", "FullTime", "Prague"]);
    expect(ai?.description.length).toBeGreaterThan(1000);
    expect(ai?.raw).not.toHaveProperty("descriptionHtml");
    expect(ai?.raw).not.toHaveProperty("descriptionPlain");
  });

  test("keeps Czech locations and drops foreign non-remote jobs", () => {
    const offers = parseBoard(rohlik, "Rohlík");
    expect(offers.map((o) => o.title)).toEqual(["Senior Product Engineer", "FC Worker - CZ"]);
    expect(offers.map((o) => o.city)).toEqual(["Prague", "Opatovice nad Labem"]);
  });

  test("keeps only allowlisted departments", () => {
    const offers = parseBoard(rohlik, "Rohlík", ["IT", "Product Management"]);
    expect(offers.map((o) => o.title)).toEqual(["Senior Product Engineer"]);
  });

  test("reads salary from summary components and keeps no city for fully remote jobs", () => {
    const body = JSON.stringify({ jobs: [{ id: "s1", title: "Senior Product Engineer", jobUrl: "https://example.com/s1", isRemote: true, location: "Remote (Europe)", compensation: { summaryComponents: [{ compensationType: "Salary", currencyCode: "EUR", minValue: 79000, maxValue: 105000 }] } }] });
    const [senior] = parseBoard(body, "Checkly");
    expect(senior?.tags[0]).toBe("fully remote");
    expect(senior?.locationText).toBe("Remote (Europe)");
    expect(senior?.city).toBeNull();
    expect([senior?.salaryMin, senior?.salaryMax, senior?.currency]).toEqual([79000, 105000, "EUR"]);
  });

  test("judges relevance: unspecified or Europe location keeps a remote job, a foreign office does not", () => {
    const job = (patch: Partial<AshbyJob>) => ({ id: "x", title: "T", jobUrl: "u", ...patch });
    expect(isRelevant(job({ isRemote: true }))).toBe(true);
    expect(isRelevant(job({ isRemote: true, location: "Europe" }))).toBe(true);
    expect(isRelevant(job({ isRemote: true, location: "Remote" }))).toBe(true);
    expect(isRelevant(job({ isRemote: true, location: "Remote (UTC-3 to UTC+3)" }))).toBe(true);
    expect(isRelevant(job({ isRemote: true, location: "Remote (CET)" }))).toBe(true);
    expect(isRelevant(job({ isRemote: true, location: "Remote (UTC-8 to UTC-5)" }))).toBe(false);
    expect(isRelevant(job({ isRemote: true, location: "Remote - United States" }))).toBe(false);
    expect(isRelevant(job({ workplaceType: "OnSite", location: "Berlin, Germany" }))).toBe(false);
  });
});

function stubbed(statusFor: (org: string) => { status: number; body?: string }) {
  const calls: string[] = [];
  const fetchText: FetchText = async (url) => {
    calls.push(url);
    const org = new URL(url).pathname.split("/").pop() ?? "";
    const { status, body = "" } = statusFor(org);
    return { status, url, body };
  };
  return { fetchText, calls };
}

/** One warn line per skipped org is expected; keep the test output clean. */
async function collectQuietly(collector: Collector) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await collector.collect();
  } finally {
    console.warn = warn;
  }
}

const ORGS = [
  { id: "apify", name: "Apify" },
  { id: "ghost", name: "Ghost" },
  { id: "checkly", name: "Checkly" },
];

describe("ashby collector", () => {
  test("requests one board per org and skips an unknown org without failing the run", async () => {
    const site = stubbed((org) => (org === "ghost" ? { status: 404 } : { status: 200, body: bodies[org] ?? "" }));
    const offers = await collectQuietly(createAshbyCollector({ fetchText: site.fetchText, orgs: ORGS }));
    expect(site.calls).toEqual([
      "https://api.ashbyhq.com/posting-api/job-board/apify?includeCompensation=true",
      "https://api.ashbyhq.com/posting-api/job-board/ghost?includeCompensation=true",
      "https://api.ashbyhq.com/posting-api/job-board/checkly?includeCompensation=true",
    ]);
    expect(offers.length).toBe(4);
  });

  test("caps the org requests with maxOrgs", async () => {
    const site = stubbed((org) => ({ status: 200, body: bodies[org] ?? "" }));
    const offers = await collectQuietly(
      createAshbyCollector({ fetchText: site.fetchText, orgs: ORGS, maxOrgs: 2 }),
    );
    expect(site.calls.length).toBe(2);
    expect(offers.every((o) => o.company === "Apify")).toBe(true);
  });

  test("throws when no board loads, including 404 skips mixed with failures", async () => {
    const fail = stubbed(() => ({ status: 500 }));
    await expect(
      collectQuietly(createAshbyCollector({ fetchText: fail.fetchText, orgs: ORGS })),
    ).rejects.toThrow("no Ashby org board loaded of 3");
    const mixed = stubbed((org) => (org === "ghost" ? { status: 404 } : { status: 500 }));
    await expect(
      collectQuietly(createAshbyCollector({ fetchText: mixed.fetchText, orgs: ORGS })),
    ).rejects.toThrow("no Ashby org board loaded of 3");
  });
});
