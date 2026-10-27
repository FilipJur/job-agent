import type { Database } from "bun:sqlite";
import { readProfile } from "../profile";
import { type MarketConfig, marketConfig } from "./config";
import { type RateForm, type RatePlace, formOf, offerRate, placeOf } from "./rates";
import { type SkillStat, skillStats } from "./skills";

export interface RateBand {
  form: RateForm;
  place: RatePlace;
  n: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

export interface RateSample {
  offerId: number;
  title: string;
  company: string | null;
  url: string;
  source: string;
  form: RateForm;
  place: RatePlace;
  czkPerHour: number;
  basis: "salary" | "text";
}

export interface MarketReport {
  generatedAt: string;
  offers: number;
  withRate: number;
  currentRate: number;
  rates: RateBand[];
  samples: RateSample[];
  skills: SkillStat[];
  leverage: SkillStat[];
}

interface MarketRow {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string | null;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  raw_json: string;
  score: number | null;
  verdict: string | null;
  gaps: string | null;
}

const FORMS: RateForm[] = ["hpp", "contract"];
const PLACES: Exclude<RatePlace, "all">[] = ["olomouc", "remote", "praha", "other"];
const LEVERAGE_TOP = 8;

/** Percentile `p` (0–1) of ascending `sorted` by linear interpolation between closest ranks; null when empty. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const below = sorted[lo] ?? 0;
  const above = sorted[Math.min(lo + 1, sorted.length - 1)] ?? below;
  return below + (h - lo) * (above - below);
}

function band(form: RateForm, place: RatePlace, values: number[]): RateBand {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (v: number | null): number | null => (v === null ? null : Math.round(v));
  return {
    form,
    place,
    n: sorted.length,
    p25: round(percentile(sorted, 0.25)),
    median: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
  };
}

/**
 * Rate bands, rate samples and skill demand over all stored offers and their latest scores.
 * `profile` is the raw profile text deciding which skills are owned (default: the live profile).
 */
export function marketReport(
  db: Database,
  now: Date = new Date(),
  cfg: MarketConfig = marketConfig,
  profile: string = readProfile(),
): MarketReport {
  // Latest score per offer: newest scored_at, then highest id (the rule of src/repo.ts).
  const rows = db
    .query<MarketRow, []>(
      `SELECT o.id, o.source, o.url, o.title, o.company, o.description, o.salary_min, o.salary_max, o.currency, o.raw_json,
              s.score, s.verdict, s.gaps
       FROM offers o
       LEFT JOIN offer_scores s ON s.offer_id = o.id AND NOT EXISTS (
         SELECT 1 FROM offer_scores s2 WHERE s2.offer_id = o.id
           AND (s2.scored_at > s.scored_at OR (s2.scored_at = s.scored_at AND s2.id > s.id)))
       ORDER BY o.id`,
    )
    .all();
  const labels = new Map<number, string[]>();
  for (const { offer_id, label } of db
    .query<{ offer_id: number; label: string }, []>("SELECT offer_id, label FROM offer_labels")
    .all()) {
    labels.set(offer_id, [...(labels.get(offer_id) ?? []), label]);
  }

  const samples: RateSample[] = [];
  for (const r of rows) {
    const rate = offerRate(
      {
        source: r.source,
        salaryMin: r.salary_min,
        salaryMax: r.salary_max,
        currency: r.currency,
        rawJson: r.raw_json,
        description: r.description,
      },
      cfg,
    );
    if (rate === null) continue;
    const offerLabels = labels.get(r.id) ?? [];
    samples.push({
      offerId: r.id,
      title: r.title,
      company: r.company,
      url: r.url,
      source: r.source,
      form: formOf(offerLabels),
      place: placeOf(offerLabels),
      ...rate,
    });
  }
  samples.sort((a, b) => b.czkPerHour - a.czkPerHour || a.offerId - b.offerId);

  const rates: RateBand[] = [];
  for (const form of FORMS) {
    const ofForm = samples.filter((s) => s.form === form);
    for (const place of PLACES) {
      const values = ofForm.filter((s) => s.place === place).map((s) => s.czkPerHour);
      if (values.length > 0) rates.push(band(form, place, values));
    }
    rates.push(band(form, "all", ofForm.map((s) => s.czkPerHour)));
  }

  const skills = skillStats(
    rows.map((r) => ({ text: `${r.title}\n${r.description}`, score: r.score, verdict: r.verdict, gaps: r.gaps })),
    cfg.skills,
    profile,
  );
  const leverage = skills
    .filter((s) => s.leverage > 0 && !s.owned)
    .sort((a, b) => b.leverage - a.leverage || b.gapMentions - a.gapMentions || a.skill.localeCompare(b.skill))
    .slice(0, LEVERAGE_TOP);

  return {
    generatedAt: now.toISOString(),
    offers: rows.length,
    withRate: samples.length,
    currentRate: cfg.currentRate,
    rates,
    samples,
    skills,
    leverage,
  };
}
