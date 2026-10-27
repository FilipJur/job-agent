/**
 * Candidate-page discovery: robots.txt Sitemap lines, sitemap indexes
 * (Yoast `sitemap_index.xml` included, one index level), /sitemap.xml,
 * then conventional careers-path fallbacks when sitemaps yield nothing.
 * Pricing/rate-card pages are never candidates: the user only cares about
 * what an agency pays a developer, and client price lists poisoned the old rates.
 */
import { extractLinks } from "./links";
import type { FetchText } from "../types";

export const CAREERS_WORDS = [
  "kariera",
  "career",
  "prace",
  "volne-pozice",
  "pozice",
  "hledame",
  "spoluprace",
  "jobs",
  "join",
  "tym",
];

/** Slugs that signal a job-detail page rather than a careers listing (kept only via link following). */
const DETAIL_WORDS = [
  "programator", "developer", "vyvojar", "react", "wordpress", "frontend", "backend", "fullstack", "full-stack",
  "pozice", "position", "job", "nabidka", "nabídka", "spoluprace", "spolupráce", "hledame", "hledáme", "tym", "team",
  "kariera", "career", "prace", "volne-pozice",
];

const SITEMAP_NAMES = ["sitemap_index.xml", "sitemap.xml", "sitemap-index.xml", "wp-sitemap.xml"];

const FALLBACK_PATHS = ["/kariera", "/kariera/", "/career", "/careers", "/prace", "/volne-pozice", "/spoluprace"];

export function isCareersUrl(url: string): boolean {
  const path = url.toLowerCase().split(/[?#]/)[0] ?? "";
  return CAREERS_WORDS.some((w) => new RegExp(`(?:^|[/_-])${w}(?:$|[/_-])`).test(path));
}

function isDetailUrl(url: string): boolean {
  const path = url.toLowerCase().split(/[?#]/)[0] ?? "";
  return DETAIL_WORDS.some((w) => path.includes(w));
}

/** All <loc> URLs of a sitemap body, in document order. Followed one index level. */
export function sitemapLocs(body: string): string[] {
  return [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1] ?? "");
}

export function isSitemapIndex(body: string): boolean {
  return /<sitemapindex[\s>]/i.test(body);
}

/** Resolves a relative location against the sitemap URL; null when unusable. */
function resolveUrl(base: string, loc: string): string | null {
  try {
    return new URL(loc, base).toString();
  } catch {
    return null;
  }
}

interface Collector {
  push: (url: string) => void;
  found: string[];
  seen: Set<string>;
  sameSite: (url: string) => boolean;
  get: (url: string) => Promise<{ body: string } | null>;
  origin: string;
}

/** Adds one sitemap's locs (or one index level of child sitemaps) to the candidates. */
async function collectSitemap(c: Collector, sitemapUrl: string): Promise<void> {
  const sm = await c.get(sitemapUrl);
  if (!sm) return;
  if (isSitemapIndex(sm.body)) {
    for (const child of sitemapLocs(sm.body)) {
      const childUrl = resolveUrl(sitemapUrl, child);
      if (!childUrl || !c.sameSite(childUrl)) continue;
      const sub = await c.get(childUrl);
      if (!sub || isSitemapIndex(sub.body)) continue;
      for (const l of sitemapLocs(sub.body)) c.push(resolveUrl(childUrl, l) ?? "");
    }
  } else {
    for (const l of sitemapLocs(sm.body)) c.push(resolveUrl(sitemapUrl, l) ?? "");
  }
}

/**
 * Candidate careers/job page URLs for one agency site. Never throws: a missing
 * sitemap falls back to conventional paths; unparseable XML yields the same.
 * Detail pages are linked from the careers pages, so crawlers follow those links too.
 */
export async function discoverPages(fetchText: FetchText, web: string): Promise<string[]> {
  const careers: string[] = [];
  const details: string[] = [];
  const seen = new Set<string>();
  const push = (url: string): void => {
    if (seen.has(url)) return;
    if (isDetailUrl(url)) {
      seen.add(url);
      details.push(url);
    } else if (isCareersUrl(url)) {
      seen.add(url);
      careers.push(url);
    }
  };

  const origin = new URL(web).origin;
  /** Same site under the www variant (or vice versa); cross-domain links still excluded. */
  const sameSite = (url: string): boolean => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const base = new URL(origin).hostname.toLowerCase();
      return host === base || host === `www.${base}` || base === `www.${host}`;
    } catch {
      return false;
    }
  };
  const get = async (url: string): Promise<{ body: string } | null> => {
    try {
      const res = await fetchText(url);
      return res.status >= 200 && res.status < 300 ? { body: res.body } : null;
    } catch {
      return null;
    }
  };
  const c: Collector = { push, found: careers, seen, sameSite, get, origin };

  const robots = await get(`${origin}/robots.txt`);
  if (robots) {
    const sitemaps: string[] = [];
    for (const line of robots.body.split("\n")) {
      const m = /^[ \t]*sitemap\s*:\s*(\S+)/im.exec(line);
      if (m) {
        const loc = resolveUrl(origin, m[1] ?? "");
        if (loc) sitemaps.push(loc);
      }
    }
    for (const sm of sitemaps.slice(0, 8)) await collectSitemap(c, sm);
  }

  if (careers.length === 0 && details.length === 0) {
    for (const name of SITEMAP_NAMES) await collectSitemap(c, `${origin}/${name}`);
  }

  // Fallbacks try both the web origin and its www variant: sitemap-less sites
  // often serve on only one of them. Interleaved per path so a page cap that
  // consumes N paths still covers both hosts.
  if (careers.length === 0 && details.length === 0) {
    const alt = origin.includes("://www.") ? origin.replace("://www.", "://") : origin.replace("://", "://www.");
    for (const p of FALLBACK_PATHS) for (const base of [origin, alt]) push(`${base}${p}`);
  }
  // Detail pages carry the quote the judgment needs; careers listings come second.
  // Most stack-relevant roles (React/WordPress/programátor) go first so a page cap still covers them.
  const rank = (url: string): number => {
    const path = url.toLowerCase();
    if (/react-developer|wordpress|programator/.test(path)) return 0;
    if (/developer|frontend|backend|full-?stack|vyvojar|vyvoj/.test(path)) return 1;
    return 2;
  };
  details.sort((a, b) => rank(a) - rank(b));
  return [...details, ...careers];
}

/**
 * Job-detail URLs linked from already-fetched careers pages: same host only,
 * matching a detail slug or a careers word (sub-listings), capped at `limit`.
 * Detail pages carry the quote the judgment needs, so a `/kariera/` listing
 * that only links to `/programator-pro-shoptet-e-shopy/` still resolves.
 */
export function detailLinks(pages: Array<{ url: string; body: string }>, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>(pages.map((p) => p.url));
  for (const p of pages) {
    for (const link of extractLinks(p.body, p.url)) {
      if (seen.has(link)) continue;
      if (!isDetailUrl(link) && !isCareersUrl(link)) continue;
      seen.add(link);
      out.push(link);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
