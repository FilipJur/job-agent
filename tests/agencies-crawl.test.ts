import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { crawlAgency, isCrawlDue } from "../src/agencies/crawl";
import { discoverPages } from "../src/agencies/discover";
import type { FetchText } from "../src/types";

const fixture = (name: string): Promise<string> => readFile(new URL(`./fixtures/agencies/${name}`, import.meta.url), "utf8");

/** Fake fetcher serving fixed URLs; records calls so page-cap tests can count them. */
function fakeFetch(routes: Record<string, string>, calls: string[] = []): FetchText {
  return async (url) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return { status: 404, url, body: "" };
    return { status: 200, url, body };
  };
}

describe("agencies-crawl", () => {
  test("explicit IČO call yields hiring true with the sentence", async () => {
    const html = await fixture("kariera-ico.html");
    const origin = "https://example.cz";
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: html }),
      { id: 1, name: "Example", web: origin },
      "2026-10-27T00:00:00.000Z",
    );
    expect(outcome.crawl.hiringIco).toBe(true);
    expect(outcome.crawl.hiringEvidence).toBe("Hledáme PHP vývojáře na externí spolupráci (IČO).");
    expect(outcome.crawl.careersUrl).toBe(`${origin}/kariera`);
    expect(outcome.crawl.crawledAt).toBe("2026-10-27T00:00:00.000Z");
  });

  test("HPP-only page yields hiring false", async () => {
    const html = await fixture("kariera-hpp.html");
    const origin = "https://example.cz";
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: html }),
      { id: 1, name: "Example", web: origin },
      "2026-10-27T00:00:00.000Z",
    );
    expect(outcome.crawl.hiringIco).toBe(false);
    expect(outcome.crawl.hiringEvidence).toBeNull();
  });

  test("list-item offer ('Co nabízíme' + 'Práci na HPP nebo živnost') counts", async () => {
    const origin = "https://example.cz";
    const html = `<html><body><h4>Co nabízíme</h4><ul><li>Práci na hlavní pracovní poměr nebo živnost</li><li>Možnost full-time i part-time spolupráce</li></ul></body></html>`;
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: html }),
      { id: 1, name: "Example", web: origin },
      "2026-10-27T00:00:00.000Z",
    );
    expect(outcome.crawl.hiringIco).toBe(true);
    expect(outcome.crawl.hiringEvidence).toContain("živnost");
  });

  test("rate formats: careers vs pricing context", async () => {
    const cases: Array<{ body: string; path: string; rate: string; min: number; max: number }> = [
      { body: "Hodinová sazba 800 Kč.", path: "/kariera", rate: "800 Kč/h (nabídka pro externisty)", min: 800, max: 800 },
      { body: "Spolupráce od 600 Kč za hodinu.", path: "/kariera", rate: "600 Kč/h (nabídka pro externisty)", min: 600, max: 600 },
      { body: "Ceník: weby 1 200 Kč/h pro klienty.", path: "/cenik", rate: "1 200 Kč/h (ceník pro klienty)", min: 1200, max: 1200 },
      {
        body: "Externistům platíme 500–700 Kč/hod.",
        path: "/kariera",
        rate: "500–700 Kč/h (nabídka pro externisty)",
        min: 500,
        max: 700,
      },
    ];
    for (const c of cases) {
      const origin = "https://example.cz";
      const url = `${origin}${c.path}`;
      const outcome = await crawlAgency(
        fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [url]: `<html><body><p>${c.body}</p></body></html>` }),
        { id: 1, name: "Example", web: origin },
        "2026-10-27T00:00:00.000Z",
      );
      expect(outcome.crawl.hourlyRate).toBe(c.rate);
      expect(outcome.crawl.rateMinCzk).toBe(c.min);
      expect(outcome.crawl.rateMaxCzk).toBe(c.max);
    }
  });

  test("sitemap discovery picks the careers URL and ignores the rest", async () => {
    const sitemap = await fixture("sitemap.xml");
    const origin = "https://example.cz";
    const pages = await discoverPages(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nSitemap: /sitemap.xml\n", [`${origin}/sitemap.xml`]: sitemap }),
      origin,
    );
    expect(pages).toEqual([`${origin}/kariera`]);
  });

  test("failing site stores nulls with crawledAt and never throws", async () => {
    const failing: FetchText = async () => {
      throw new Error("boom");
    };
    const outcome = await crawlAgency(failing, { id: 1, name: "Example", web: "https://example.cz" });
    expect(outcome.crawl.hiringIco).toBe(false);
    expect(outcome.crawl.careersUrl).toBeNull();
    expect(outcome.error).not.toBeNull();
    expect(outcome.crawl.crawledAt).not.toBeNull();
  });

  test("crawl guard: null and 7-day-old are due, fresh is not", () => {
    const now = Date.parse("2026-10-27T00:00:00.000Z");
    expect(isCrawlDue(null, now)).toBe(true);
    expect(isCrawlDue("2026-10-20T00:00:00.000Z", now)).toBe(true);
    expect(isCrawlDue("2026-10-22T00:00:00.000Z", now)).toBe(false);
  });

  test("page cap: at most 8 pages fetched per agency", async () => {
    const calls: string[] = [];
    const origin = "https://example.cz";
    const urls = Array.from({ length: 30 }, (_, i) => `${origin}/kariera/strana-${i}`);
    const routes: Record<string, string> = { [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n" };
    for (const u of urls) routes[u] = `<html><body><loc>${u}</loc></body></html>`;
    routes[`${origin}/sitemap.xml`] =
      `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
    await crawlAgency(fakeFetch(routes, calls), { id: 1, name: "Example", web: origin });
    expect(calls.filter((c) => urls.includes(c)).length).toBeLessThanOrEqual(8);
  });
});
