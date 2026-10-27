/** Candidate-page discovery: robots.txt Sitemap lines, /sitemap.xml (one index level), path fallbacks. */

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
  "cenik",
  "pricing",
];

const FALLBACK_PATHS = ["/kariera", "/kariera/", "/career", "/careers", "/prace", "/volne-pozice", "/spoluprace", "/cenik"];

export function isCareersUrl(url: string): boolean {
  const path = url.toLowerCase().split(/[?#]/)[0] ?? "";
  return CAREERS_WORDS.some((w) => new RegExp(`(?:^|[/_-])${w}(?:$|[/_-])`).test(path));
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

/**
 * Candidate careers/pricing page URLs for one agency site. Never throws: a missing
 * sitemap falls back to conventional paths; unparseable XML yields the same.
 */
export async function discoverPages(fetchText: FetchText, web: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (url: string): void => {
    if (!seen.has(url) && isCareersUrl(url)) {
      seen.add(url);
      found.push(url);
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

  const robots = await get(`${origin}/robots.txt`);
  if (robots) for (const line of robots.body.split("\n")) {
    const m = /^[ \t]*sitemap\s*:\s*(\S+)/im.exec(line);
    if (m) {
      const loc = resolveUrl(origin, m[1] ?? "");
      if (loc) {
        const sm = await get(loc);
        if (sm) {
          if (isSitemapIndex(sm.body)) {
            for (const child of sitemapLocs(sm.body).slice(0, 8)) {
              const childUrl = resolveUrl(loc, child);
              if (!childUrl || !sameSite(childUrl)) continue;
              const sub = await get(childUrl);
              if (sub) for (const l of sitemapLocs(sub.body)) push(resolveUrl(childUrl, l) ?? "");
            }
          } else {
            for (const l of sitemapLocs(sm.body)) push(resolveUrl(loc, l) ?? "");
          }
        }
      }
    }
  }

  const main = await get(`${origin}/sitemap.xml`);
  if (main) {
    if (isSitemapIndex(main.body)) {
      for (const child of sitemapLocs(main.body).slice(0, 8)) {
        const childUrl = resolveUrl(`${origin}/sitemap.xml`, child);
        if (!childUrl || !sameSite(childUrl)) continue;
        const sub = await get(childUrl);
        if (!sub || isSitemapIndex(sub.body)) continue;
        for (const l of sitemapLocs(sub.body)) push(resolveUrl(childUrl, l) ?? "");
      }
    } else {
      for (const l of sitemapLocs(main.body)) push(resolveUrl(`${origin}/sitemap.xml`, l) ?? "");
    }
  }

  // Fallbacks try both the web origin and its www variant: sitemap-less sites
  // often serve on only one of them; record mode caches each exact URL string.
  if (found.length === 0) {
    const alt = origin.includes("://www.") ? origin.replace("://www.", "://") : origin.replace("://", "://www.");
    for (const base of [origin, alt]) for (const p of FALLBACK_PATHS) push(`${base}${p}`);
  }
  return found;
}
