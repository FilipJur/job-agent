/**
 * Agency website crawl: per agency with a `web` URL, discover candidate careers/pricing
 * pages via sitemaps, fetch up to MAX_PAGES, extract IČO-hiring evidence and hourly rates.
 * One failing site is reported in the result; it never throws.
 */
import { discoverPages } from "./discover";
import { findHiringEvidence, pageText, parseRate } from "./parse";
import type { AgencyCrawl, FetchText } from "../types";

export const MAX_PAGES = 8;
/** Agencies are recrawled at most once per week unless --force is passed. */
export const CRAWL_GUARD_MS = 7 * 24 * 3600 * 1000;

export function isCrawlDue(crawledAt: string | null, nowMs: number): boolean {
  if (crawledAt === null) return true;
  const t = Date.parse(crawledAt);
  return !Number.isFinite(t) || nowMs - t >= CRAWL_GUARD_MS;
}

const PRICING_WORDS = ["cenik", "pricing"];

function isPricingUrl(url: string): boolean {
  const path = url.toLowerCase().split(/[?#]/)[0] ?? "";
  return PRICING_WORDS.some((w) => new RegExp(`(?:^|[/_-])${w}(?:$|[/_-])`).test(path));
}

export interface AgencyCrawlInput {
  id: number;
  name: string;
  web: string | null;
}

export interface AgencyCrawlOutcome {
  id: number;
  name: string;
  crawl: AgencyCrawl;
  pagesFetched: number;
  checkedAtLeastOnePage: boolean;
  error: string | null;
}

async function get(fetchText: FetchText, url: string): Promise<string | null> {
  try {
    const res = await fetchText(url);
    return res.status >= 200 && res.status < 300 ? res.body : null;
  } catch {
    return null;
  }
}

/** Crawl one agency site. Never throws. */
export async function crawlAgency(fetchText: FetchText, agency: AgencyCrawlInput, nowIso?: string): Promise<AgencyCrawlOutcome> {
  const now = nowIso ?? new Date().toISOString();
  const blank = (error: string | null, pagesFetched: number, checked: boolean): AgencyCrawlOutcome => ({
    id: agency.id,
    name: agency.name,
    crawl: {
      careersUrl: null,
      hiringIco: false,
      hiringEvidence: null,
      hourlyRate: null,
      rateMinCzk: null,
      rateMaxCzk: null,
      crawledAt: now,
    },
    pagesFetched,
    checkedAtLeastOnePage: checked,
    error,
  });

  let candidates: string[];
  try {
    if (!agency.web) return blank("no web url", 0, false);
    candidates = await discoverPages(fetchText, agency.web);
  } catch (e) {
    return blank(e instanceof Error ? e.message : String(e), 0, false);
  }

  let fetched = 0;
  let hiring: { url: string; evidence: string } | null = null;
  let rate: { url: string; min: number; max: number; text: string } | null = null;

  for (const url of candidates.slice(0, MAX_PAGES)) {
    const body = await get(fetchText, url);
    if (body === null) continue;
    fetched += 1;
    const text = pageText(body);
    if (!hiring) {
      const evidence = findHiringEvidence(text);
      if (evidence) hiring = { url, evidence };
    }
    if (!rate) {
      const r = parseRate(text);
      if (r) {
        const pricing = isPricingUrl(url);
        rate = {
          url,
          min: r.min,
          max: r.max,
          text: `${r.text} (${pricing ? "ceník pro klienty" : "nabídka pro externisty"})`,
        };
      }
    }
    if (hiring && rate) break;
  }

  const error = fetched === 0 ? "no page fetched" : null;
  return {
    id: agency.id,
    name: agency.name,
    crawl: {
      careersUrl: hiring?.url ?? rate?.url ?? null,
      hiringIco: hiring !== null,
      hiringEvidence: hiring?.evidence ?? null,
      hourlyRate: rate?.text ?? null,
      rateMinCzk: rate?.min ?? null,
      rateMaxCzk: rate?.max ?? null,
      crawledAt: now,
    },
    pagesFetched: fetched,
    checkedAtLeastOnePage: fetched > 0,
    error,
  };
}
