import type { MarketConfig } from "./config";

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
  return null;
}

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

// Thousands groups ("1 200", "1.200") first, then plain or decimal numbers ("450", "37,50").
const AMT = String.raw`\d{1,3}(?:[ .,]\d{3})+(?!\d)|\d+(?:[.,]\d{1,2})?`;
const DASH = String.raw`\s*(?:-|–|—|až|to)\s*`;
const CUR = String.raw`kč|czk|€|eur[oa]?`;
const HOUR = String.raw`(?:\s*\/\s*|\s+(?:per|za|an|a)\s+)(?:hodinu|hodina|hod\.?|hours?|hrs?|h)(?![\p{L}\d])`;
/** "450 Kč/h", "500–700 CZK/hod", "40 EUR per hour", "500 Kč – 700 Kč/h". */
const SUFFIX_CUR = new RegExp(String.raw`(?<![\d.,])(${AMT})(?:\s*(?:${CUR}))?(?:${DASH}(${AMT}))?\s*(${CUR})${HOUR}`, "giu");
/** "€40/h", "€40–60 per hour", "EUR 40/h". */
const PREFIX_CUR = new RegExp(String.raw`(€|eur)\s?(${AMT})(?:${DASH}(?:€|eur)?\s?(${AMT}))?${HOUR}`, "giu");

function parseAmount(raw: string): number {
  return /^\d{1,3}(?:[ .,]\d{3})+$/.test(raw) ? Number(raw.replace(/[ .,]/g, "")) : Number(raw.replace(",", "."));
}

/** CZK/h from explicit hourly rates in the text: midpoint of the lowest and highest mention. */
export function textRate(text: string, cfg: MarketConfig): number | null {
  const t = text.replace(/[\u00a0\u2009\u202f]/g, " ");
  const values: number[] = [];
  const add = (currency: string, ...amounts: (string | undefined)[]): void => {
    const factor = czkFactor(currency, cfg);
    if (factor === null) return;
    for (const a of amounts) if (a !== undefined) values.push(parseAmount(a) * factor);
  };
  for (const m of t.matchAll(SUFFIX_CUR)) add(m[3] ?? "", m[1], m[2]);
  for (const m of t.matchAll(PREFIX_CUR)) add(m[1] ?? "", m[2], m[3]);
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
