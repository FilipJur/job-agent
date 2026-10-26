import config from "../../../config/sources.json";
import type { Collector, RawOffer } from "../../types";
import { parseDetail, type DetailData } from "./detail";
import { createHttpClient, type FetchText } from "./http";
import { parseSerp, type SerpCard } from "./serp";

export type { FetchText } from "./http";

export interface JobsCzOptions {
  keywords?: string[];
  maxPagesPerKeyword?: number;
  /** Already-stored offers; known ids skip the detail fetch and yield a card-only offer. */
  isKnown?: (sourceId: string) => boolean;
  /** Cap on detail fetches per run; further unknown cards are skipped entirely. */
  maxDetails?: number;
  fetchText?: FetchText;
  now?: () => Date;
}

const SOURCE = "jobscz";
const BASE = "https://www.jobs.cz";

export function createJobsCzCollector(opts: JobsCzOptions = {}): Collector {
  const keywords = opts.keywords ?? config.jobscz.keywords;
  const maxPages = opts.maxPagesPerKeyword ?? config.jobscz.maxPagesPerKeyword;
  const fetchText = opts.fetchText ?? createHttpClient().fetchText;
  const isKnown = opts.isKnown ?? (() => false);
  const maxDetails = opts.maxDetails ?? Infinity;
  const now = opts.now ?? (() => new Date());

  async function collectCards(): Promise<SerpCard[]> {
    const cards = new Map<string, SerpCard>();
    const errors: string[] = [];
    let attempts = 0;
    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        const url = `${BASE}/prace/?q=${encodeURIComponent(keyword)}&page=${page}`;
        attempts++;
        let found: SerpCard[];
        try {
          const res = await fetchText(url);
          if (res.status !== 200) {
            errors.push(`HTTP ${res.status} for ${url}`);
            break;
          }
          found = parseSerp(res.body, now());
        } catch (e) {
          errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (found.length === 0) break;
        for (const card of found) {
          const seen = cards.get(card.sourceId);
          cards.set(
            card.sourceId,
            seen ? { ...seen, tags: [...new Set([...seen.tags, ...card.tags])] } : card,
          );
        }
      }
    }
    if (attempts > 0 && errors.length === attempts) {
      throw new Error(`all ${attempts} jobs.cz SERP requests failed; first: ${errors[0]}`);
    }
    return [...cards.values()];
  }

  function serpOnlyOffer(card: SerpCard, detailError: string | null = null): RawOffer {
    return {
      source: SOURCE,
      sourceId: card.sourceId,
      url: `${BASE}/rpd/${card.sourceId}/`,
      title: card.title,
      company: card.company,
      locationText: card.locationText,
      city: null,
      salaryMin: card.salaryMin,
      salaryMax: card.salaryMax,
      currency: card.currency,
      publishedAt: card.publishedAt,
      description: "",
      tags: [...card.tags],
      partial: true,
      raw: { card, detail: null, detailUrl: null, detailError },
    };
  }

  async function toRawOffer(card: SerpCard): Promise<RawOffer> {
    const url = `${BASE}/rpd/${card.sourceId}/`;
    let detail: DetailData;
    let detailUrl: string;
    try {
      const res = await fetchText(url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      detail = parseDetail(res.body);
      detailUrl = res.url;
    } catch (e) {
      return serpOnlyOffer(card, e instanceof Error ? e.message : String(e));
    }

    const d = detail;
    const salary = d.salaryMin !== null || d.salaryMax !== null ? d : card;
    return {
      source: SOURCE,
      sourceId: card.sourceId,
      url,
      title: d.shape !== "og" ? (d.title ?? card.title) : card.title,
      company: card.company ?? d.company ?? null,
      locationText: d.locationText ?? card.locationText,
      city: d.city ?? null,
      salaryMin: salary.salaryMin,
      salaryMax: salary.salaryMax,
      currency: salary.currency,
      publishedAt: d.publishedAt ?? card.publishedAt,
      description: d.description ?? "",
      tags: [...new Set([...card.tags, ...d.tags])],
      partial: d.partial,
      raw: { card, detail: d, detailUrl, detailError: null },
    };
  }

  return {
    name: SOURCE,
    async collect() {
      const offers: RawOffer[] = [];
      let detailsUsed = 0;
      for (const card of await collectCards()) {
        if (isKnown(card.sourceId)) {
          offers.push(serpOnlyOffer(card));
        } else if (detailsUsed >= maxDetails) {
          continue;
        } else {
          detailsUsed++;
          offers.push(await toRawOffer(card));
        }
      }
      return offers;
    },
  };
}
