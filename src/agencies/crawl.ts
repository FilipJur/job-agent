/**
 * Agency website crawl: per agency with a `web` URL, discover candidate careers/job
 * pages via sitemaps (+ link-followed job details), fetch up to MAX_PAGES, and run
 * the LLM judgment over the page texts. One failing site is reported in the result;
 * fetching never throws, but a judge failure is recorded as the outcome error.
 */
import { detailLinks, discoverPages } from "./discover";
import { judgeAgency, type AgencyJudgment, type JudgeOptions } from "./judge";
import { pageText } from "./parse";
import type { AgencyCrawl, FetchText } from "../types";

export const MAX_PAGES = 8;
/** Agencies are recrawled at most once per week unless --force is passed. */
export const CRAWL_GUARD_MS = 7 * 24 * 3600 * 1000;

export function isCrawlDue(crawledAt: string | null, nowMs: number): boolean {
  if (crawledAt === null) return true;
  const t = Date.parse(crawledAt);
  return !Number.isFinite(t) || nowMs - t >= CRAWL_GUARD_MS;
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
  promptTokens: number;
  completionTokens: number;
}

async function get(fetchText: FetchText, url: string): Promise<string | null> {
  try {
    const res = await fetchText(url);
    return res.status >= 200 && res.status < 300 ? res.body : null;
  } catch {
    return null;
  }
}

function blank(now: string, error: string | null, pagesFetched: number, checked: boolean): AgencyCrawlOutcome {
  return {
    id: 0,
    name: "",
    crawl: {
      devPositionOpen: false,
      positionTitle: null,
      positionUrl: null,
      evidenceQuote: null,
      form: null,
      devRate: null,
      remoteOrOlomouc: false,
      aiFit: null,
      aiReason: null,
      crawledAt: now,
    },
    pagesFetched,
    checkedAtLeastOnePage: checked,
    error,
    promptTokens: 0,
    completionTokens: 0,
  };
}

/** Crawl one agency site: fetch pages, judge them. Never throws. */
export async function crawlAgency(
  fetchText: FetchText,
  agency: AgencyCrawlInput,
  nowIso?: string,
  judgeOpts?: JudgeOptions,
): Promise<AgencyCrawlOutcome> {
  const now = nowIso ?? new Date().toISOString();
  const empty = (error: string | null, pagesFetched: number, checked: boolean): AgencyCrawlOutcome => ({
    ...blank(now, error, pagesFetched, checked),
    id: agency.id,
    name: agency.name,
  });

  let candidates: string[];
  try {
    if (!agency.web) return empty("no web url", 0, false);
    candidates = await discoverPages(fetchText, agency.web);
  } catch (e) {
    return empty(e instanceof Error ? e.message : String(e), 0, false);
  }

  const pages: Array<{ url: string; body: string }> = [];
  let fetched = 0;
  for (const url of candidates.slice(0, MAX_PAGES)) {
    const body = await get(fetchText, url);
    if (body === null) continue;
    fetched += 1;
    pages.push({ url, body });
  }
  // Follow job-detail links from the careers pages (same host, capped by MAX_PAGES).
  if (pages.length > 0) {
    for (const url of detailLinks(pages, MAX_PAGES).slice(0, Math.max(0, MAX_PAGES - fetched))) {
      if (pages.some((p) => p.url === url)) continue;
      const body = await get(fetchText, url);
      if (body === null) continue;
      fetched += 1;
      pages.push({ url, body });
      if (fetched >= MAX_PAGES) break;
    }
  }

  if (fetched === 0) return empty("no page fetched", 0, false);
  if (!judgeOpts) {
    return empty("no judge options (missing API key?)", fetched, true);
  }
  try {
    const texts = pages.map((p) => ({ url: p.url, text: pageText(p.body) })).filter((p) => p.text.length > 0);
    if (texts.length === 0) return empty("no page text extracted", fetched, true);
    const { judgment, promptTokens, completionTokens } = await judgeAgency(texts, judgeOpts);
    return {
      id: agency.id,
      name: agency.name,
      crawl: { ...toCrawl(judgment), crawledAt: now },
      pagesFetched: fetched,
      checkedAtLeastOnePage: true,
      error: null,
      promptTokens,
      completionTokens,
    };
  } catch (e) {
    return empty(e instanceof Error ? e.message : String(e), fetched, true);
  }
}

function toCrawl(j: AgencyJudgment): Omit<AgencyCrawl, "crawledAt"> {
  return {
    devPositionOpen: j.devPositionOpen,
    positionTitle: j.positionTitle,
    positionUrl: j.positionUrl,
    evidenceQuote: j.evidenceQuote,
    form: j.form,
    devRate: j.devRate,
    remoteOrOlomouc: j.remoteOrOlomouc,
    aiFit: j.fit,
    aiReason: j.reason,
  };
}
