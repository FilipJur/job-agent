import config from "../../../config/startupjobs.json";
import type { Collector, FetchText, RawOffer } from "../../types";
import { parseDetail } from "./detail";
import { parseSitemap, slugMatcher, type OfferLink } from "./sitemap";

const SOURCE = "startupjobs";

export interface StartupJobsOptions {
  fetchText: FetchText;
  /** Already-stored offers; known ids skip the detail request entirely. */
  isKnown?: (sourceId: string) => boolean;
  /** Cap on detail requests per run (from --limit). */
  maxDetails?: number;
  sitemapUrl?: string;
  keywords?: string[];
}

export function createStartupJobsCollector(opts: StartupJobsOptions): Collector {
  const { fetchText } = opts;
  const isKnown = opts.isKnown ?? (() => false);
  const maxDetails = opts.maxDetails ?? Infinity;
  const sitemapUrl = opts.sitemapUrl ?? config.sitemapUrl;
  const matches = slugMatcher(opts.keywords ?? config.slugKeywords);

  /** A failed detail still yields the offer, so the next run retries it (pipeline keys on `detailError`). */
  const failed = (link: OfferLink, detailError: string): RawOffer => ({
    source: SOURCE,
    sourceId: link.sourceId,
    url: link.url,
    title: link.slug.replace(/-+/g, " "), // readable stand-in when the page gave nothing
    company: null,
    locationText: null,
    city: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    publishedAt: null,
    description: "",
    tags: [],
    partial: true,
    raw: { link, detail: null, detailUrl: null, detailError },
  });

  return {
    name: SOURCE,
    async collect() {
      const res = await fetchText(sitemapUrl);
      if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${sitemapUrl}`);
      const links = parseSitemap(res.body).filter((link) => matches(link.slug));

      const offers: RawOffer[] = [];
      let requests = 0;
      let pages = 0;
      let unreadable = 0;
      for (const link of links) {
        if (isKnown(link.sourceId) || requests >= maxDetails) continue;
        requests++;
        let page: { status: number; url: string; body: string };
        try {
          page = await fetchText(link.url);
        } catch (e) {
          offers.push(failed(link, e instanceof Error ? e.message : String(e)));
          continue;
        }
        if (page.status === 404) continue; // gone from the site; the sitemap still lists it
        if (page.status !== 200) {
          offers.push(failed(link, `HTTP ${page.status}`));
          continue;
        }
        pages++;
        const parsed = parseDetail(page.body);
        if (parsed.kind === "expired") continue; // closed offer: skipped, not stored
        if (parsed.kind === "unreadable") {
          unreadable++;
          offers.push(failed(link, "no JobPosting JSON-LD"));
          continue;
        }
        const d = parsed.detail;
        offers.push({
          source: SOURCE,
          sourceId: link.sourceId,
          url: link.url,
          title: d.title || link.slug.replace(/-+/g, " "),
          company: d.company,
          locationText: d.locationText,
          city: d.city,
          salaryMin: d.salaryMin,
          salaryMax: d.salaryMax,
          currency: d.currency,
          publishedAt: d.publishedAt,
          description: d.description,
          tags: d.tags,
          partial: false,
          raw: { link, detail: d, detailUrl: page.url, detailError: null },
        });
      }
      // Every readable page lacking JSON-LD means the markup changed, not that every offer closed.
      if (pages > 0 && unreadable === pages) {
        throw new Error(`all ${pages} startupjobs detail pages lack JobPosting JSON-LD`);
      }
      return offers;
    },
  };
}
