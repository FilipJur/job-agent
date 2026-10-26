import { describe, expect, test } from "bun:test";
import { createJobsCzCollector, type FetchText } from "../src/collectors/jobscz";
import { parseSerp } from "../src/collectors/jobscz/serp";

const fixture = (name: string) => Bun.file(new URL(`./fixtures/jobscz/${name}`, import.meta.url)).text();

const NOW = new Date("2026-10-26T12:00:00Z");
const EMPTY = "<html><body><p>Žádné nabídky</p></body></html>";
const serp = await fixture("serp-ai-engineer.html");
const jsonld = await fixture("detail-jsonld.html");
const remote = await fixture("detail-remote-ico.html");
const widget = await fixture("detail-widget.html");

const cards = parseSerp(serp, NOW);
const ids = cards.map((c) => c.sourceId);
const [widgetId, remoteId, throwId, jsonldId] = ids;
const UNIQUE = new Set(ids).size;

/** Fake jobs.cz: SERP per (keyword, page) and detail per id. widgetId → og shape, remoteId → html shape, throwId → fetch error. */
function jobsCz(serpFor: (kw: string, page: number) => { status?: number; body: string } = (_kw, page) => ({ body: page === 1 ? serp : EMPTY })) {
  const calls: string[] = [];
  const fetchText: FetchText = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/prace/") {
      const { status = 200, body } = serpFor(u.searchParams.get("q") ?? "", Number(u.searchParams.get("page")));
      return { status, url, body };
    }
    const id = u.pathname.split("/")[2] ?? "";
    if (id === throwId) throw new Error("boom");
    const body = id === widgetId ? widget : id === remoteId ? remote : jsonld;
    return { status: 200, url, body };
  };
  return { fetchText, calls };
}

const serpCalls = (calls: string[]) => calls.filter((u) => u.startsWith("https://www.jobs.cz/prace/")).length;

describe("jobs.cz collector", () => {
  test("dedupes across keywords and merges detail data", async () => {
    const site = jobsCz();
    const offers = await createJobsCzCollector({
      keywords: ["AI engineer", "LLM"],
      maxPagesPerKeyword: 2,
      fetchText: site.fetchText,
      now: () => NOW,
    }).collect();

    expect(offers.length).toBe(UNIQUE);
    expect(new Set(offers.map((o) => o.sourceId)).size).toBe(offers.length);
    expect(serpCalls(site.calls)).toBe(4);
    expect(site.calls.filter((u) => u.includes("/rpd/")).length).toBe(UNIQUE);
    expect(site.calls[0]).toBe("https://www.jobs.cz/prace/?q=AI%20engineer&page=1");

    for (const o of offers) {
      expect(o.source).toBe("jobscz");
      expect(o.url).toBe(`https://www.jobs.cz/rpd/${o.sourceId}/`);
    }

    const jsonldOffer = offers.find((o) => o.sourceId === jsonldId);
    expect(jsonldOffer?.title).toBe("REACT Developer");
    expect(jsonldOffer?.salaryMin).toBe(75000);
    expect(jsonldOffer?.salaryMax).toBe(100000);
    expect(jsonldOffer?.currency).toBe("CZK");
    expect(jsonldOffer?.description.length).toBeGreaterThan(0);
    expect(jsonldOffer?.publishedAt).not.toBeNull();
    expect(jsonldOffer?.partial).toBe(false);

    const htmlOffer = offers.find((o) => o.sourceId === remoteId);
    expect(htmlOffer?.partial).toBe(false);
    expect(htmlOffer?.description.length).toBeGreaterThan(0);
    expect(htmlOffer?.tags.length).toBeGreaterThan(0);
  });

  test("og detail shape yields partial offer with SERP card title", async () => {
    const offers = await createJobsCzCollector({
      keywords: ["AI engineer"],
      fetchText: jobsCz().fetchText,
      now: () => NOW,
    }).collect();
    const og = offers.find((o) => o.sourceId === widgetId);
    expect(og?.partial).toBe(true);
    expect(og?.title).toBe(cards[0]?.title);
    expect(og?.description.length).toBeGreaterThan(0);
  });

  test("one failing detail yields card-only partial offer without aborting", async () => {
    const offers = await createJobsCzCollector({
      keywords: ["AI engineer"],
      fetchText: jobsCz().fetchText,
      now: () => NOW,
    }).collect();
    expect(offers.length).toBe(UNIQUE);
    const failed = offers.find((o) => o.sourceId === throwId);
    const card = cards.find((c) => c.sourceId === throwId);
    expect(failed?.partial).toBe(true);
    expect(failed?.description).toBe("");
    expect(failed?.title).toBe(card?.title);
    expect(failed?.company).toBe(card?.company ?? null);
    expect(failed?.raw).toMatchObject({ detail: null, detailError: "boom" });
  });

  test("known card ids skip the detail fetch and reuse SERP data", async () => {
    const site = jobsCz();
    const known = cards.find((c) => c.sourceId === jsonldId);
    const offers = await createJobsCzCollector({
      keywords: ["AI engineer"],
      fetchText: site.fetchText,
      now: () => NOW,
      isKnown: (id) => id === jsonldId,
    }).collect();

    expect(site.calls.some((u) => u.includes(`/rpd/${jsonldId}/`))).toBe(false);
    expect(site.calls.filter((u) => u.includes("/rpd/")).length).toBe(UNIQUE - 1);
    const offer = offers.find((o) => o.sourceId === jsonldId);
    expect(offer?.partial).toBe(true);
    expect(offer?.description).toBe("");
    expect(offer?.title).toBe(known?.title);
    expect(offer?.company).toBe(known?.company ?? null);
  });

  test("a previously failed offer is not treated as known and its detail is fetched", async () => {
    const site = jobsCz();
    await createJobsCzCollector({
      keywords: ["AI engineer"],
      fetchText: site.fetchText,
      now: () => NOW,
      isKnown: () => false,
    }).collect();

    expect(site.calls.some((u) => u.includes(`/rpd/${throwId}/`))).toBe(true);
  });

  test("throws when all SERP requests fail (first error summarised)", async () => {
    const site = jobsCz(() => {
      throw new Error("network down");
    });
    await expect(
      createJobsCzCollector({ keywords: ["AI engineer", "LLM"], fetchText: site.fetchText, now: () => NOW }).collect(),
    ).rejects.toThrow(/all 2 jobs\.cz SERP requests failed; first: .*network down/);
  });

  test("a failing keyword is skipped when others succeed", async () => {
    const site = jobsCz((kw, page) => (kw === "AI engineer" ? { status: 500, body: "" } : { body: page === 1 ? serp : EMPTY }));
    const offers = await createJobsCzCollector({
      keywords: ["AI engineer", "LLM"],
      fetchText: site.fetchText,
      now: () => NOW,
    }).collect();
    expect(offers.length).toBe(UNIQUE);
  });

  test("stops paging a keyword on an empty page", async () => {
    const site = jobsCz();
    await createJobsCzCollector({
      keywords: ["AI engineer"],
      maxPagesPerKeyword: 5,
      fetchText: site.fetchText,
      now: () => NOW,
    }).collect();
    expect(serpCalls(site.calls)).toBe(2);
  });

  test("stops paging a keyword on non-200 SERP status", async () => {
    const site = jobsCz((_kw, page) => (page === 1 ? { body: serp } : { status: 503, body: "" }));
    await createJobsCzCollector({
      keywords: ["AI engineer"],
      maxPagesPerKeyword: 5,
      fetchText: site.fetchText,
      now: () => NOW,
    }).collect();
    expect(serpCalls(site.calls)).toBe(2);
  });

  test("respects maxPagesPerKeyword", async () => {
    const withCards = (_kw: string, page: number) => ({ body: page <= 2 ? serp : EMPTY });
    const one = jobsCz(withCards);
    await createJobsCzCollector({ keywords: ["LLM"], maxPagesPerKeyword: 1, fetchText: one.fetchText, now: () => NOW }).collect();
    expect(serpCalls(one.calls)).toBe(1);

    const three = jobsCz(withCards);
    await createJobsCzCollector({ keywords: ["LLM"], maxPagesPerKeyword: 5, fetchText: three.fetchText, now: () => NOW }).collect();
    expect(serpCalls(three.calls)).toBe(3);
  });
});
