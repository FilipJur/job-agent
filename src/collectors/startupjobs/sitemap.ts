/** One offer link from the sitemap: https://www.startupjobs.cz/nabidka/<id>/<slug>. */
export interface OfferLink {
  url: string;
  /** Numeric offer id from the URL, e.g. "88845". */
  sourceId: string;
  slug: string;
}

const OFFER_URL = /^https:\/\/www\.startupjobs\.cz\/nabidka\/(\d+)\/([^/?#]+)\/?$/;

/** Offer links of a sitemap body, in document order; non-offer URLs are dropped. */
export function parseSitemap(body: string): OfferLink[] {
  const links: OfferLink[] = [];
  for (const [, loc = ""] of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const m = OFFER_URL.exec(loc);
    if (m) links.push({ url: loc, sourceId: m[1] ?? "", slug: m[2] ?? "" });
  }
  return links;
}

/**
 * Slug filter: a keyword matches at a token boundary and may end mid-token, so "web" catches
 * webdesigner/website and "agent" catches agentic/agentura. Multi-part keywords ("full-stack")
 * also match the joined form ("fullstack").
 */
export function slugMatcher(keywords: string[]): (slug: string) => boolean {
  const patterns = keywords.map((keyword) => {
    const parts = keyword.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 0);
    return new RegExp(`(?:^|[^a-z0-9])${parts.join("[^a-z0-9]*")}`);
  });
  return (slug) => {
    const s = slug.toLowerCase();
    return patterns.some((pattern) => pattern.test(s));
  };
}
