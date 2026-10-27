export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";
export type LabelOrigin = "rule" | "llm";

/** Fetches a URL as text: the shape shared by the HTTP client, the cache wrapper and test fakes. */
export type FetchText = (url: string) => Promise<{ status: number; url: string; body: string }>;

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

export type Tab = "hpp" | "kontrakty";
export type Verdict = "up" | "down" | "responded" | "hidden" | "aspiration";
/** Verdicts stored in the `feedback` table: the UI verdicts plus `cleared`, which cancels the previous verdict. */
export type FeedbackVerdict = Verdict | "cleared";
export type AgencyStatus = "new" | "contacted" | "replied" | "meeting" | "work" | "declined";

export interface OfferScore {
  score: number;
  reason: string;
  gaps: string;
  model: string;
  scoredAt: string;
  verdict: ScoreVerdict;
  blocker: string;
  direction: string;
}

export interface OfferFeedback {
  verdict: Verdict;
  reason: string | null;
  createdAt: string;
}

/** What the model decided about an offer: fit = actionable, blocked = unusable now, aspiration = great fit, wrong timing/place. */
export type ScoreVerdict = "fit" | "blocked" | "aspiration";

export interface OfferRow {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string | null;
  city: string | null;
  workplace: Workplace;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  partial: boolean;
  labels: string[];
  score: OfferScore | null;
  feedback: OfferFeedback | null;
}

/** One row of the Aspirations tab: user `aspiration` feedback or the model's `aspiration` verdict. */
export interface AspirationRow {
  id: number;
  title: string;
  company: string | null;
  url: string;
  city: string | null;
  workplace: Workplace;
  locationText: string | null;
  score: number | null;
  reason: string;
  direction: string;
  gaps: string;
  blocker: string;
  source: "ai" | "user";
  labels: string[];
  model: string;
  scoredAt: string;
}

export interface ScoreInput {
  offerId: number;
  score: number;
  reason: string;
  gaps: string;
  model: string;
  profileHash: string;
  scoredAt: string;
  labels?: string[];
  verdict: ScoreVerdict;
  blocker: string;
  direction: string;
}

export interface OfferToScore {
  id: number;
  title: string;
  company: string | null;
  locationText: string | null;
  city: string | null;
  workplace: Workplace;
  description: string;
  labels: string[];
}

export type AgencyRow = {
  id: number;
  name: string;
  web: string | null;
  city: string | null;
  focus: string | null;
  stack: string | null;
  signal: string | null;
  email: string | null;
  contactUrl: string | null;
  phone: string | null;
  fit: number;
  status: AgencyStatus;
  notes: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
} & AgencyCrawl;

/** Result of crawling an agency website (src/agencies/crawl.ts); all null/false until crawled. */
export interface AgencyCrawl {
  /** Page where the hiring evidence was found (careers page or offer page). */
  careersUrl: string | null;
  /** True only with explicit evidence that the agency seeks someone on IČO/freelance/externally. */
  hiringIco: boolean;
  /** Short quote from that page proving `hiringIco`. */
  hiringEvidence: string | null;
  /** Hourly rate as written on their site (e.g. "500–700 Kč/h"), null if not published. */
  hourlyRate: string | null;
  rateMinCzk: number | null;
  rateMaxCzk: number | null;
  crawledAt: string | null;
}

export interface AgencyPatch {
  status?: AgencyStatus;
  notes?: string | null;
  lastContactAt?: string | null;
}

export interface AgencySeed {
  name: string;
  web: string | null;
  city: string | null;
  focus: string | null;
  stack: string | null;
  signal: string | null;
  email: string | null;
  phone: string | null;
  contact_url?: string | null;
  fit: number;
}
