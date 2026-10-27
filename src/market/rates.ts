import type { MarketConfig } from "./config";
import { fold } from "./skills";

export type RateForm = "hpp" | "contract";
export type RatePlace = "olomouc" | "remote" | "praha" | "other" | "all";
export type RateBasis = "salary" | "text";
type Period = "hour" | "month" | "year";

export interface RateInput {
  source: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  rawJson: string;
  description: string;
}

export interface OfferRate {
  czkPerHour: number;
  basis: RateBasis;
}

const MIN_RATE = 80;
const MAX_RATE = 5000;
const CONTRACT_LABELS = ["ico", "freelance", "dpp-dpc"];

/** Contract labels win over `hpp`; no form label counts as `hpp`, like the HPP tab. */
export function formOf(labels: readonly string[]): RateForm {
  return labels.some((l) => CONTRACT_LABELS.includes(l)) ? "contract" : "hpp";
}

export function placeOf(labels: readonly string[]): Exclude<RatePlace, "all"> {
  if (labels.includes("olomouc") || labels.includes("okoli-olomouce")) return "olomouc";
  if (labels.includes("remote") || labels.includes("remote-cz") || labels.includes("remote-eu")) return "remote";
  if (labels.includes("praha")) return "praha";
  return "other";
}

/**
 * Unit of the salary columns per source: the jobs.cz and startupjobs collectors keep
 * only MONTH amounts; Ashby stores the compensation component's own interval in raw_json.
 * HN and Workable never fill the columns.
 */
const SOURCE_PERIOD: Record<string, Period> = { jobscz: "month", startupjobs: "month" };
const ASHBY_INTERVALS: Record<string, Period> = { "1 HOUR": "hour", "1 MONTH": "month", "1 YEAR": "year" };

function ashbyPeriod(rawJson: string): Period | null {
  const raw = JSON.parse(rawJson) as {
    compensation?: { summaryComponents?: { compensationType?: string; interval?: string }[] | null } | null;
  };
  const salary = raw.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
  return ASHBY_INTERVALS[salary?.interval ?? ""] ?? null;
}

function czkFactor(currency: string, cfg: MarketConfig): number | null {
  if (/^(czk|kč|kc|korun)$/i.test(currency)) return 1;
  if (/^(eur|€|euro|eura)$/i.test(currency)) return cfg.eurCzk;
  if (/^(usd|\$|dollar|dollars)$/i.test(currency)) return cfg.usdCzk;
  if (/^(gbp|£|pound|pounds)$/i.test(currency)) return cfg.gbpCzk;
  return null;
}

// Thousands groups ("1 200", "1.200") first, then plain or decimal numbers ("450", "37,50").
const AMT = String.raw`\d{1,3}(?:[ .,]\d{3})+(?!\d)|\d+(?:[.,]\d{1,2})?`;
const DASH = String.raw`\s*(?:-|–|—|az|to)\s*`;
const CUR = String.raw`kc|czk|\$|usd|€|eur[oa]?|£|gbp|dollars?|pounds?`;
const HOUR = String.raw`(?:\s*\/\s*|\s+(?:per|za|an|a)\s+)(?:hodinu|hodina|hod\.?|hours?|hrs?|h)(?![\p{L}\d])`;
/** "/month", "per month", "mesicne", "/mes" (text is folded, so ASCII only). */
const MONTH = String.raw`(?:\s*\/\s*|\s+(?:per|za|an|a)\s+|\s+)(?:months?|mo\.?|mesic[a-z]*|mes\.?)(?![\p{L}\d])`;
/** "/MD", "/den", "per day" (text is folded: "dnů" -> "dnu", "dní" -> "dni"). */
const DAY = String.raw`(?:\s*\/\s*|\s+(?:per|za|an|a)\s+)(?:days?|den|dne|dny|dnu|dni|md)(?![\p{L}\d])`;
/** "/yr", "per year" (explicit yearly in text, e.g. "$380,895/yr"). */
const YEAR =
  String.raw`(?:\s*\/\s*|\s+(?:per|za|an|a)\s+|\s+)(?:years?|yrs?|yr|annual[a-z]*|rok[a-z]*|let[a-z]*)(?![\p{L}\d])`;

/** "450 Kč/h", "500–700 CZK/hod", "$23-$34 USD/hour", "€5000–€6000 per month", "7 000 Kč/MD". */
const suffixRe = (period: string): RegExp =>
  new RegExp(
    String.raw`(?<![\d.,])(${AMT})(?:\s*(?:${CUR}))?(?:${DASH}(?:${CUR})?\s?(${AMT}))?\s*(${CUR})${period}`,
    "giu",
  );
/** "€40/h", "$23-$34 USD/hour", "EUR 40/h". */
const prefixRe = (period: string): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\d])(${CUR})\s?(${AMT})(?:${DASH}(?:${CUR})?\s?(${AMT}))?${period}`, "giu");

const SUFFIX_HOUR = suffixRe(HOUR);
const PREFIX_HOUR = prefixRe(HOUR);
const SUFFIX_MONTH = suffixRe(MONTH);
const PREFIX_MONTH = prefixRe(MONTH);
const SUFFIX_DAY = suffixRe(DAY);
const PREFIX_DAY = prefixRe(DAY);
const SUFFIX_YEAR = suffixRe(YEAR);
const PREFIX_YEAR = prefixRe(YEAR);

const plausible = (rate: number): boolean => rate >= MIN_RATE && rate <= MAX_RATE;

/** CZK/h from the salary columns: midpoint of min/max (or the one present), divided by the source's period. */
export function salaryRate(o: RateInput, cfg: MarketConfig): number | null {
  const amount =
    o.salaryMin !== null && o.salaryMax !== null ? (o.salaryMin + o.salaryMax) / 2 : (o.salaryMin ?? o.salaryMax);
  if (amount === null || o.currency === null) return null;
  const factor = czkFactor(o.currency, cfg);
  const period = o.source === "ashby" ? ashbyPeriod(o.rawJson) : (SOURCE_PERIOD[o.source] ?? null);
  if (factor === null || period === null) return null;
  const hours = period === "hour" ? 1 : period === "month" ? cfg.hoursPerMonth : cfg.hoursPerYear;
  return (amount * factor) / hours;
}

function parseAmount(raw: string): number {
  return /^\d{1,3}(?:[ .,]\d{3})+$/.test(raw) ? Number(raw.replace(/[ .,]/g, "")) : Number(raw.replace(",", "."));
}

/**
 * CZK/h from explicit rates in the text: hourly as-is, monthly ÷ hoursPerMonth,
 * man-day ÷ 8, yearly ÷ hoursPerYear. Midpoint of the lowest and highest mention wins.
 */
export function textRate(text: string, cfg: MarketConfig): number | null {
  const t = fold(text).replace(/[   ]/g, " ");
  const values: number[] = [];
  const add = (divisor: number, currency: string, ...amounts: (string | undefined)[]): void => {
    const factor = czkFactor(currency, cfg);
    if (factor === null) return;
    for (const a of amounts) if (a !== undefined) values.push((parseAmount(a) * factor) / divisor);
  };
  for (const m of t.matchAll(SUFFIX_HOUR)) add(1, m[3] ?? "", m[1], m[2]);
  for (const m of t.matchAll(PREFIX_HOUR)) add(1, m[1] ?? "", m[2], m[3]);
  for (const m of t.matchAll(SUFFIX_MONTH)) add(cfg.hoursPerMonth, m[3] ?? "", m[1], m[2]);
  for (const m of t.matchAll(PREFIX_MONTH)) add(cfg.hoursPerMonth, m[1] ?? "", m[2], m[3]);
  for (const m of t.matchAll(SUFFIX_DAY)) add(8, m[3] ?? "", m[1], m[2]);
  for (const m of t.matchAll(PREFIX_DAY)) add(8, m[1] ?? "", m[2], m[3]);
  for (const m of t.matchAll(SUFFIX_YEAR)) add(cfg.hoursPerYear, m[3] ?? "", m[1], m[2]);
  for (const m of t.matchAll(PREFIX_YEAR)) add(cfg.hoursPerYear, m[1] ?? "", m[2], m[3]);
  // Bare "$200K-$250K" yearly ranges (HN posts): the only bare amounts, so no unit mixup.
  const yearly = [
    ...t.matchAll(new RegExp(String.raw`(?<![\d.,])(\$|€|£|usd|gbp|eur)\s*(\d+(?:[.,]\d{1,2})?)\s*k(?![\p{L}\d])`, "giu")),
  ].filter((m) => Number.parseFloat((m[2] ?? "").replace(",", ".")) >= 10);
  for (const m of yearly) {
    const factor = czkFactor(m[1] ?? "", cfg);
    if (factor === null) continue;
    values.push((Number((m[2] ?? "").replace(",", ".")) * 1000 * factor) / cfg.hoursPerYear);
  }
  if (values.length === 0) return null;
  return (Math.min(...values) + Math.max(...values)) / 2;
}

/** Salary columns first, explicit hourly text second; implausible results (< 80 or > 5000 CZK/h) are dropped. */
export function offerRate(o: RateInput, cfg: MarketConfig): OfferRate | null {
  const salary = salaryRate(o, cfg);
  if (salary !== null && plausible(salary)) return { czkPerHour: Math.round(salary), basis: "salary" };
  const text = textRate(o.description, cfg);
  if (text !== null && plausible(text)) return { czkPerHour: Math.round(text), basis: "text" };
  return null;
}
