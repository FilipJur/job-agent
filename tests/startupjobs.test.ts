import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../config/startupjobs.json";
import { createStartupJobsCollector } from "../src/collectors/startupjobs";
import { parseDetail } from "../src/collectors/startupjobs/detail";
import { parseSitemap, slugMatcher } from "../src/collectors/startupjobs/sitemap";
import type { FetchText } from "../src/types";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/startupjobs", name), "utf8");

const sitemap = fixture("sitemap-offers.xml");
const monthly = fixture("detail-monthly.html");
const remote = fixture("detail-remote.html");
const hourly = fixture("detail-hourly.html");
const expired = fixture("detail-expired.html");

const links = parseSitemap(sitemap);
const matches = slugMatcher(config.slugKeywords);
const kept = links.filter((link) => matches(link.slug));

describe("sitemap filter", () => {
  test("keeps matching offer slugs of the real sitemap and drops unrelated roles", () => {
    expect(links.length).toBe(382);
    expect(kept.length).toBe(78);
    const slugs = kept.map((link) => link.slug);
    expect(slugs).toContain("remote-full-stack-developer-react-node-js");
    expect(slugs).toContain("senior-vyvojar-ka-esales-platformy-php-remote-130-160-000-kc");
    expect(slugs).toContain("webdesigner-pracujici-se-solidpixels-nebo-webflow-se-znalosti-seo");
    expect(slugs).not.toContain("java-developer");
    expect(slugs).not.toContain("sales-development-representative-sdr-czechia-remote");
  });

  test("multi-part keywords match both spellings", () => {
    expect(matches("senior-full-stack-php-developer")).toBe(true);
    expect(matches("vyvojar-vyvojarka-fullstack-fe-be")).toBe(true);
    expect(matches("senior-frontend-vyvojar-v-mixit-full-time")).toBe(true);
  });
});

describe("parseDetail: JSON-LD", () => {
  test("monthly page: title, company, location, salary, tags", () => {
    const result = parseDetail(monthly);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const d = result.detail;
    expect(d.title).toContain("Generative AI & ML Developer");
    expect(d.company).toBe("Blindspot Solutions");
    expect(d.city).toBe("Praha");
    expect(d.locationText).toBe("Praha, Česko");
    expect(d.salaryMin).toBe(80000);
    expect(d.salaryMax).toBe(120000);
    expect(d.currency).toBe("CZK");
    expect(d.publishedAt).toBe("2026-10-14T09:29:55.000Z");
    expect(d.tags).toEqual(["FULL_TIME", "PART_TIME", "contractor", "Praha", "Česko"]);
    expect(d.description).not.toContain("<p");
    expect(d.description).not.toContain("&nbsp;");
    expect(d.description).toContain("\n");
  });

  test("remote page: TELECOMMUTE becomes the fully remote tag", () => {
    const result = parseDetail(remote);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.detail.tags).toContain("fully remote");
    expect(result.detail.tags).toContain("contractor");
    expect(result.detail.city).toBeNull();
    expect(result.detail.locationText).toBe("Česko");
    expect(result.detail.salaryMin).toBe(60000);
    expect(result.detail.salaryMax).toBe(85000);
  });

  test("hourly rate is not stored as a monthly salary", () => {
    const result = parseDetail(hourly);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.detail.salaryMin).toBeNull();
    expect(result.detail.salaryMax).toBeNull();
    expect(result.detail.currency).toBeNull();
    expect(result.detail.tags).toContain("contractor");
  });

  test("closed offer is recognised as expired", () => {
    expect(parseDetail(expired)).toEqual({ kind: "expired" });
  });
});

describe("collector", () => {
  const site = (detailFor: (link: { url: string }) => { status?: number; body: string }) => {
    const calls: string[] = [];
    const fetchText: FetchText = async (url) => {
      calls.push(url);
      if (url === config.sitemapUrl) return { status: 200, url, body: sitemap };
      const { status = 200, body } = detailFor({ url });
      return { status, url, body };
    };
    return { fetchText, calls };
  };

  test("skips expired offers and caps detail requests", async () => {
    const s = site(({ url }) => ({ body: url === kept[0]!.url ? expired : monthly }));
    const offers = await createStartupJobsCollector({ fetchText: s.fetchText, maxDetails: 2 }).collect();

    expect(s.calls).toEqual([config.sitemapUrl, kept[0]!.url, kept[1]!.url]);
    expect(offers.map((o) => o.sourceId)).toEqual([kept[1]!.sourceId]);
    expect(offers[0]).toMatchObject({
      source: "startupjobs",
      url: kept[1]!.url,
      company: "Blindspot Solutions",
      partial: false,
    });
  });

  test("isKnown skips the detail request of a stored offer", async () => {
    const s = site(() => ({ body: monthly }));
    const offers = await createStartupJobsCollector({
      fetchText: s.fetchText,
      isKnown: (id) => id === kept[0]!.sourceId,
      maxDetails: 1,
    }).collect();

    expect(s.calls).toEqual([config.sitemapUrl, kept[1]!.url]);
    expect(offers.map((o) => o.sourceId)).toEqual([kept[1]!.sourceId]);
  });

  test("page without JobPosting is kept as a partial offer with detailError", async () => {
    const s = site(({ url }) => ({ body: url === kept[0]!.url ? "<html><body>Údržba</body></html>" : monthly }));
    const offers = await createStartupJobsCollector({ fetchText: s.fetchText, maxDetails: 2 }).collect();

    expect(offers).toHaveLength(2);
    expect(offers[0]!.partial).toBe(true);
    expect(offers[0]!.title).toBe(kept[0]!.slug.replace(/-/g, " "));
    expect(JSON.stringify(offers[0]!.raw)).toContain('"detailError":"no JobPosting JSON-LD"');
    expect(offers[1]!.partial).toBe(false);
  });
});
