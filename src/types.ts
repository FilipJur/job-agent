export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";
export type LabelOrigin = "rule" | "llm";

/** What a collector emits: source data as found, before normalization. */
export interface RawOffer {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  locationText: string | null;
  /** City if the source states it explicitly (e.g. JSON-LD addressLocality). */
  city?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
  description: string;
  /** Short source-provided facts (badges, contract type, benefits) used by rule labels. */
  tags: string[];
  /** True when only a partial detail was available (e.g. og: fallback). */
  partial: boolean;
  raw: unknown;
}

export interface Offer {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  locationText: string | null;
  city: string | null;
  workplace: Workplace;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
  description: string;
  dedupKey: string;
  tags: string[];
  labels: string[];
  rawJson: string;
  partial: boolean;
}

export interface Collector {
  name: string;
  collect(): Promise<RawOffer[]>;
}
