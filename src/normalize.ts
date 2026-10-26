import { applyRules } from "./labels/apply";
import { foldDiacritics } from "./text";
import type { Offer, RawOffer, Workplace } from "./types";

/** Query params that carry tracking only, never identity. `utm_*` is matched by prefix. */
const TRACKING_PARAMS: Record<string, true> = {
  gclid: true,
  _gl: true,
  searchid: true,
  rps: true,
  impressionid: true,
  originjobaduuid: true,
};

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || TRACKING_PARAMS[k]) url.searchParams.delete(key);
  }
  return url.toString().replace(/\?$/, "");
}

/** Comparison form: folded, lowercase, punctuation collapsed to single spaces. */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return foldDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_FORMS = /\b(spol|s r o|a s)\b/g;

export function normalizeCompany(s: string | null | undefined): string {
  return normalizeText(s).replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}

export function dedupKey(title: string, company: string | null, city: string | null): string {
  return [normalizeText(title), normalizeCompany(company), normalizeText(city)].join("|");
}

/**
 * City from a free-form location such as "Nové sady 996/25, Brno – Staré Brno",
 * "Praha 4 - Chodov" or "Královéhradecký kraj" (region only -> null).
 */
export function deriveCity(locationText: string | null | undefined): string | null {
  if (!locationText) return null;
  const parts = locationText
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Drop street parts ("Nové sady 996/25", "U Pergamenky 1145/12"); keep "Praha 4".
  const candidates = parts.filter((p) => !/\d+\s*(\/\s*\d+)?\s*[a-z]?$/i.test(p) || /^praha\b/i.test(p));
  const first = candidates[0];
  if (!first) return null;
  const head = first.split(/\s+[–—-]\s+/)[0]?.trim() ?? "";
  if (/^praha\b/i.test(head)) return "Praha";
  if (!head || /\bkraj\b/i.test(head) || /\bokres\b/i.test(head)) return null;
  return head;
}

function workplaceFrom(labels: string[]): Workplace {
  if (labels.includes("remote")) return "remote";
  if (labels.includes("hybrid")) return "hybrid";
  if (labels.includes("onsite")) return "onsite";
  return "unknown";
}

export function normalize(raw: RawOffer): Offer {
  const city = raw.city?.trim() || deriveCity(raw.locationText);
  const labels = applyRules({
    title: raw.title,
    description: raw.description,
    tags: raw.tags.join("\n"),
    city: city ?? "",
  });
  return {
    source: raw.source,
    sourceId: raw.sourceId,
    url: normalizeUrl(raw.url),
    title: raw.title.trim(),
    company: raw.company?.trim() || null,
    locationText: raw.locationText?.trim() || null,
    city,
    workplace: workplaceFrom(labels),
    salaryMin: raw.salaryMin,
    salaryMax: raw.salaryMax,
    currency: raw.currency,
    publishedAt: raw.publishedAt,
    description: raw.description,
    dedupKey: dedupKey(raw.title, raw.company, city),
    tags: raw.tags,
    labels,
    rawJson: JSON.stringify(raw.raw),
    partial: raw.partial,
  };
}
