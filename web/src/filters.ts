import type { OfferFilters } from "./api";
import type { OfferRow } from "./types";

export type SortKey = "score" | "newest";

/** Client-side filters applied to the offers already loaded for the current tab. */
export interface ClientFilters {
  labels: string[];
  minScore: number;
  source: string;
  query: string;
  sort: SortKey;
}

export const NO_CLIENT_FILTERS: ClientFilters = { labels: [], minScore: 0, source: "", query: "", sort: "score" };

export const MIN_SCORES = [0, 5, 7, 9] as const;

/** Number of active filters, counting each selected label separately. */
export function activeFilterCount(filters: ClientFilters, server: OfferFilters): number {
  return (
    filters.labels.length +
    Object.values(server).filter(Boolean).length +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.source !== "" ? 1 : 0) +
    (filters.query.trim() !== "" ? 1 : 0)
  );
}

/** Lowercase and strip diacritics so "Prace" finds "Práce". */
const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Skip {
  labels?: boolean;
}

function matches(offer: OfferRow, filters: ClientFilters, folded: string, skip: Skip): boolean {
  if (!skip.labels && !filters.labels.every((label) => offer.labels.includes(label))) return false;
  if (filters.minScore > 0 && (offer.score === null || offer.score.score < filters.minScore)) return false;
  if (filters.source !== "" && offer.source !== filters.source) return false;
  if (folded !== "" && !fold(`${offer.title}\n${offer.company ?? ""}\n${offer.score?.reason ?? ""}`).includes(folded)) {
    return false;
  }
  return true;
}

const byNewest = (a: OfferRow, b: OfferRow): number => b.firstSeenAt.localeCompare(a.firstSeenAt) || b.id - a.id;

const bySortKey = (sort: SortKey) => (a: OfferRow, b: OfferRow): number => {
  if (sort === "newest") return byNewest(a, b);
  // Unscored offers go last; ties fall back to newest.
  return (b.score?.score ?? -1) - (a.score?.score ?? -1) || byNewest(a, b);
};

export function applyFilters(offers: OfferRow[], filters: ClientFilters): OfferRow[] {
  const folded = fold(filters.query.trim());
  return offers.filter((offer) => matches(offer, filters, folded, {})).sort(bySortKey(filters.sort));
}

export interface LabelCount {
  label: string;
  /** Offers that would remain if this label were selected on top of the current filters. */
  count: number;
  selected: boolean;
}

/**
 * Chips come from the whole loaded list so they do not jump around while filtering.
 * Selected labels stay visible even when absent from this tab's list (count 0).
 */
export function labelCounts(offers: OfferRow[], filters: ClientFilters): LabelCount[] {
  const folded = fold(filters.query.trim());
  const base = offers.filter((offer) => matches(offer, filters, folded, { labels: true }));
  const total = new Map<string, number>();
  for (const offer of offers) for (const label of offer.labels) total.set(label, (total.get(label) ?? 0) + 1);
  for (const label of filters.labels) if (!total.has(label)) total.set(label, 0);

  const result: LabelCount[] = [];
  for (const label of total.keys()) {
    const selected = filters.labels.includes(label);
    const withLabel = selected ? filters.labels : [...filters.labels, label];
    const count = base.filter((offer) => withLabel.every((wanted) => offer.labels.includes(wanted))).length;
    result.push({ label, count, selected });
  }
  return result.sort(
    (a, b) => (total.get(b.label) ?? 0) - (total.get(a.label) ?? 0) || a.label.localeCompare(b.label),
  );
}

export function sourceCounts(offers: OfferRow[]): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const offer of offers) counts.set(offer.source, (counts.get(offer.source) ?? 0) + 1);
  return [...counts]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}
