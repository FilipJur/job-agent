import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { crawlAgency, isCrawlDue } from "../src/agencies/crawl";
import { detailLinks, discoverPages } from "../src/agencies/discover";
import { validateJudgment } from "../src/agencies/judge";
import { openDb } from "../src/db";
import { listAgencies, saveAgencyCrawl, seedAgencies } from "../src/repo";
import type { FetchText } from "../src/types";

/** Fake fetcher serving fixed URLs; records calls so page-cap tests can count them. */
function fakeFetch(routes: Record<string, string>, calls: string[] = []): FetchText {
  return async (url) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return { status: 404, url, body: "" };
    return { status: 200, url, body };
  };
}

/** Judge stub: replies with the given JSON to any agency page set; counts calls. */
function fakeJudge(reply: unknown, calls: Array<number> = []) {
  return async (_url: string, _body: unknown, _key: string, _session: string) => {
    calls.push(1);
    return { status: 200, body: JSON.stringify({ output: [{ type: "message", content: [{ text: JSON.stringify(reply) }] }], usage: {} }) };
  };
}

const JUDGE_OPTS = { endpoint: "https://x.test/v1", model: "test-model", apiKey: "k", sessionId: "s" };

describe("agencies-crawl", () => {
  test("LLM judgment with a verbatim quote stores the open position", async () => {
    const quote = "Hledáme PHP vývojáře na externí spolupráci (IČO).";
    const origin = "https://example.cz";
    const html = `<html><body><h1>Kariéra</h1><p>${quote} Nabízíme dlouhodobé projekty.</p></body></html>`;
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: html }),
      { id: 1, name: "Example", web: origin },
      "2026-10-27T00:00:00.000Z",
      {
        ...JUDGE_OPTS,
        postJson: fakeJudge({
          devPositionOpen: true,
          positionTitle: "PHP vývojář",
          positionUrl: `${origin}/kariera`,
          evidenceQuote: quote,
          form: "ico",
          devRate: null,
          remoteOrOlomouc: true,
          fit: 7,
          reason: "Hledají PHP vývojáře na IČO.",
        }),
      },
    );
    expect(outcome.crawl.devPositionOpen).toBe(true);
    expect(outcome.crawl.positionTitle).toBe("PHP vývojář");
    expect(outcome.crawl.evidenceQuote).toBe(quote);
    expect(outcome.crawl.form).toBe("ico");
    expect(outcome.crawl.positionUrl).toBe(`${origin}/kariera`);
    expect(outcome.crawl.crawledAt).toBe("2026-10-27T00:00:00.000Z");
  });

  test("hallucinated quote and URL are dropped; fake open becomes closed", async () => {
    const origin = "https://example.cz";
    const html = "<html><body><h1>Kariéra</h1><p>Aktuálně nikoho nehledáme, napište nám.</p></body></html>";
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: html }),
      { id: 2, name: "Invented", web: origin },
      "2026-10-27T00:00:00.000Z",
      {
        ...JUDGE_OPTS,
        postJson: fakeJudge({
          devPositionOpen: true,
          positionTitle: "Senior React Developer",
          positionUrl: "https://evil.test/offer",
          evidenceQuote: "Hledáme seniorního React vývojáře za 5 000 Kč/h.",
          form: "ico",
          devRate: "5 000 Kč/h",
          remoteOrOlomouc: false,
          fit: 9,
          reason: "Vymyšlená pozice.",
        }),
      },
    );
    expect(outcome.crawl.devPositionOpen).toBe(false);
    expect(outcome.crawl.evidenceQuote).toBeNull();
    expect(outcome.crawl.positionTitle).toBeNull();
    expect(outcome.crawl.positionUrl).toBeNull();
    expect(outcome.crawl.devRate).toBeNull();
    expect(outcome.error).toBeNull();
  });

  test("'obsazeno' quote closes the position", async () => {
    const quote = "Pozice je obsazena, rádi však mrkneme na vaše CV.";
    const origin = "https://example.cz";
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: `<html><body><p>${quote}</p></body></html>` }),
      { id: 3, name: "Filled", web: origin },
      "2026-10-27T00:00:00.000Z",
      {
        ...JUDGE_OPTS,
        postJson: fakeJudge({
          devPositionOpen: true,
          positionTitle: "Full Stack developer",
          positionUrl: `${origin}/kariera`,
          evidenceQuote: quote,
          form: "unknown",
          devRate: null,
          remoteOrOlomouc: false,
          fit: 2,
          reason: "Pozice je obsazená.",
        }),
      },
    );
    expect(outcome.crawl.devPositionOpen).toBe(false);
    expect(outcome.crawl.positionTitle).toBeNull();
  });

  test("no API key records an error but keeps the fetched pages", async () => {
    const origin = "https://example.cz";
    const outcome = await crawlAgency(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/kariera`]: "<html><body><p>Ahoj</p></body></html>" }),
      { id: 4, name: "NoKey", web: origin },
      "2026-10-27T00:00:00.000Z",
    );
    expect(outcome.pagesFetched).toBe(1);
    expect(outcome.checkedAtLeastOnePage).toBe(true);
    expect(outcome.error).not.toBeNull();
    expect(outcome.crawl.aiFit).toBeNull();
  });

  test("failing site stores nulls with crawledAt and never throws", async () => {
    const failing: FetchText = async () => {
      throw new Error("boom");
    };
    const outcome = await crawlAgency(failing, { id: 1, name: "Example", web: "https://example.cz" }, undefined, JUDGE_OPTS);
    expect(outcome.crawl.devPositionOpen).toBe(false);
    expect(outcome.crawl.positionUrl).toBeNull();
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
    const judgeCalls: Array<number> = [];
    const origin = "https://example.cz";
    const urls = Array.from({ length: 30 }, (_, i) => `${origin}/kariera/strana-${i}`);
    const routes: Record<string, string> = { [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n" };
    for (const u of urls) routes[u] = `<html><body><loc>${u}</loc></body></html>`;
    routes[`${origin}/sitemap.xml`] =
      `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
    await crawlAgency(fakeFetch(routes, calls), { id: 1, name: "Example", web: origin }, undefined, {
      ...JUDGE_OPTS,
      postJson: fakeJudge({
        devPositionOpen: false,
        positionTitle: null,
        positionUrl: null,
        evidenceQuote: "",
        form: "unknown",
        devRate: null,
        remoteOrOlomouc: false,
        fit: 1,
        reason: "Nic.",
      }, judgeCalls),
    });
    expect(calls.filter((c) => urls.includes(c)).length).toBeLessThanOrEqual(8);
    expect(judgeCalls.length).toBe(1);
  });
});

describe("agencies-discovery", () => {
  test("sitemap discovery picks the careers URLs and ignores the rest", async () => {
    const sitemap = await readFile(new URL("./fixtures/agencies/sitemap.xml", import.meta.url), "utf8");
    const origin = "https://example.cz";
    const pages = await discoverPages(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nSitemap: /sitemap.xml\n", [`${origin}/sitemap.xml`]: sitemap }),
      origin,
    );
    expect(pages).toEqual([`${origin}/kariera`]);
  });

  test("never returns a pricing page", async () => {
    const origin = "https://example.cz";
    const sitemap = `<?xml version="1.0"?><urlset>
      <url><loc>${origin}/cenik</loc></url>
      <url><loc>${origin}/pricing</loc></url>
      <url><loc>${origin}/kariera</loc></url>
    </urlset>`;
    const pages = await discoverPages(
      fakeFetch({ [`${origin}/robots.txt`]: "User-agent: *\nDisallow:\n", [`${origin}/sitemap.xml`]: sitemap }),
      origin,
    );
    expect(pages).toEqual([`${origin}/kariera`]);
  });

  test("discovers careers page and job-detail links from Softema-like fixtures; ignores pricing", async () => {
    const kariera = await readFile(new URL("./fixtures/agencies/softema-kariera.html", import.meta.url), "utf8");
    const detail = await readFile(new URL("./fixtures/agencies/softema-detail.html", import.meta.url), "utf8");
    const origin = "https://softema.test";
    const pages = await discoverPages(
      fakeFetch({
        [`${origin}/robots.txt`]: "User-agent: *\nSitemap: /sitemap_index.xml\n",
        [`${origin}/sitemap_index.xml`]: `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/page-sitemap.xml</loc></sitemap></sitemapindex>`,
        [`${origin}/page-sitemap.xml`]: `<?xml version="1.0"?><urlset>
          <url><loc>${origin}/programator-pro-shoptet-e-shopy/</loc></url>
          <url><loc>${origin}/cenik/</loc></url>
          <url><loc>${origin}/kariera/</loc></url>
        </urlset>`,
      }),
      origin,
    );
    expect(pages).toContain(`${origin}/programator-pro-shoptet-e-shopy/`);
    expect(pages).toContain(`${origin}/kariera/`);
    expect(pages.some((p) => /cenik|pricing/i.test(p))).toBe(false);
    const links = detailLinks([{ url: `${origin}/kariera/`, body: kariera }], 8);
    expect(links).toContain(`${origin}/programator-pro-shoptet-e-shopy/`);
    expect(links.some((l: string) => /cenik/i.test(l))).toBe(false);
    expect(detail).toContain("Programátor pro Shoptet e-shopy");
  });

  test("detailLinks follows only same-host job links, capped", () => {
    const links = detailLinks(
      [
        {
          url: "https://a.test/kariera",
          body: `<a href="/programator-pro-shoptet/">x</a><a href="https://evil.test/react-dev">y</a><a href="/cenik">z</a><a href="/kariera/tym">t</a>`,
        },
      ],
      2,
    );
    expect(links).toEqual(["https://a.test/programator-pro-shoptet/", "https://a.test/kariera/tym"]);
  });

  test("fallbacks interleave bare and www hosts per path", async () => {
    const pages = await discoverPages(async () => ({ status: 404, url: "x", body: "nope" }), "https://example.cz");
    expect(pages.slice(0, 4)).toEqual([
      "https://example.cz/kariera",
      "https://www.example.cz/kariera",
      "https://example.cz/kariera/",
      "https://www.example.cz/kariera/",
    ]);
  });
});

describe("agencies-judge-validation", () => {
  const pages = [{ url: "https://a.test/kariera", text: "Hledáme vývojáře. Sazba 800 Kč/h." }];
  test("drops non-verbatim rate, keeps verbatim one", () => {
    const base = {
      devPositionOpen: true, positionTitle: "Vývojář", positionUrl: "https://a.test/kariera",
      evidenceQuote: "Hledáme vývojáře.", form: "ico", remoteOrOlomouc: true, fit: 5, reason: "OK.",
    };
    expect(validateJudgment({ ...base, devRate: "900 Kč/h" } as never, pages).devRate).toBeNull();
    expect(validateJudgment({ ...base, devRate: "800 Kč/h" } as never, pages).devRate).toBe("800 Kč/h");
  });

  test("generic quote for a specific title closes the position; title-matching quote keeps it", () => {
    const generic = {
      devPositionOpen: true, positionTitle: "Wordpress vývojář", positionUrl: "https://a.test/kariera",
      evidenceQuote: "Připojte se k nám ještě dnes", form: "unknown", devRate: null, remoteOrOlomouc: true, fit: 8, reason: "OK.",
    };
    const kept = validateJudgment(generic as never, pages);
    expect(kept.devPositionOpen).toBe(false);
    expect(kept.positionTitle).toBeNull();
    const named = {
      ...generic, positionUrl: "https://a.test/kariera",
      evidenceQuote: "Hledáme Wordpress vývojáře na dlouhodobou spolupráci.",
    };
    const pages2 = [{ url: "https://a.test/kariera", text: "Hledáme Wordpress vývojáře na dlouhodobou spolupráci." }];
    const open = validateJudgment(named as never, pages2);
    expect(open.devPositionOpen).toBe(true);
    expect(open.positionTitle).toBe("Wordpress vývojář");
    // Parenthesized suffix ("spolupráce na IČO") must not break the check on a bare careers URL.
    const paren = {
      ...generic, positionTitle: "FRONTEND DEVELOPER S PŘESAHEM DO PHP (spolupráce na IČO)",
      evidenceQuote: "Hledáme zkušeného vývojáře, který má frontend v malíku.",
    };
    const pages3 = [{ url: "https://a.test/kariera", text: "FRONTEND DEVELOPER S PŘESAHEM DO PHP (spolupráce na IČO) Hledáme zkušeného vývojáře, který má frontend v malíku." }];
    expect(validateJudgment(paren as never, pages3).devPositionOpen).toBe(true);
  });

  test("unknown form and out-of-range fit become null", () => {
    const j = validateJudgment(
      {
        devPositionOpen: false, positionTitle: null, positionUrl: null, evidenceQuote: "",
        form: "freelance", devRate: null, remoteOrOlomouc: false, fit: 99, reason: "",
      } as never,
      pages,
    );
    expect(j.form).toBeNull();
    expect(j.fit).toBeNull();
  });
});

describe("agencies-ordering", () => {
  test("open position first, then IČO-able form, stated dev rate, remote, AI fit, seed fit, name", () => {
    const db: Database = openDb(":memory:");
    try {
      const items = [
        { name: "Zeta", web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 9 },
        { name: "Beta", web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 5 },
        { name: "Alfa", web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 5 },
        { name: "Gama", web: null, city: null, focus: null, stack: null, signal: null, email: null, phone: null, fit: 3 },
      ];
      const { inserted } = seedAgencies(db, items);
      expect(inserted).toBe(4);
      const base = {
        devPositionOpen: false, positionTitle: null, positionUrl: null, evidenceQuote: null, form: null,
        devRate: null, remoteOrOlomouc: false, aiFit: null, aiReason: null, crawledAt: "t",
      } as const;
      const ids = Object.fromEntries(listAgencies(db).map((a) => [a.name, a.id]));
      // Zeta: highest seed fit but nothing open → sinks. Beta: IČO form + rate + remote + AI fit.
      saveAgencyCrawl(db, ids.Beta!, { ...base, form: "ico", devRate: "600 Kč/h", remoteOrOlomouc: true, aiFit: 7, aiReason: "r" });
      // Alfa: IČO form but no rate.
      saveAgencyCrawl(db, ids.Alfa!, { ...base, form: "both", remoteOrOlomouc: true, aiFit: 7, aiReason: "r" });
      // Gama: open position beats everything.
      saveAgencyCrawl(db, ids.Gama!, {
        ...base, devPositionOpen: true, positionTitle: "WP dev", positionUrl: "https://g.test/k",
        evidenceQuote: "Hledáme WP vývojáře.", form: "hpp", aiFit: 3, aiReason: "r",
      });
      expect(listAgencies(db).map((a) => a.name)).toEqual(["Gama", "Beta", "Alfa", "Zeta"]);
    } finally {
      db.close();
    }
  });
});
