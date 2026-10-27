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

export interface OfferOpinion {
  score: number;
  verdict: ScoreVerdict;
  reason: string;
  gaps: string;
  model: string;
  profileHash: string;
  scoredAt: string;
}

export interface OpinionInput {
  offerId: number;
  score: number;
  verdict: ScoreVerdict;
  reason: string;
  gaps: string;
  model: string;
  profileHash: string;
  scoredAt: string;
}

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
  opinion: OfferOpinion | null;
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

export type AgencyForm = "ico" | "hpp" | "both" | "unknown";

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

/** Application pipeline stages, in display order. */
export type AppStage = "drafting" | "applied" | "interview" | "offer" | "rejected" | "withdrawn";

/** One offer's application state plus the offer fields the pipeline view needs. */
export interface Application {
  offerId: number;
  stage: AppStage;
  appliedAt: string | null;
  nextActionAt: string | null;
  notes: string | null;
  updatedAt: string;
  title: string;
  company: string | null;
  url: string;
  source: string;
  score: number | null;
}

/** PUT /api/offers/:id/application: `nextActionAt`/`notes` omitted keep the stored value. */
export interface ApplicationPatch {
  stage: AppStage;
  nextActionAt?: string | null;
  notes?: string | null;
}

/** One verified fact from `data/facts.md`; ids are `F1`, `F2`, … in file order. */
export interface Fact {
  id: string;
  text: string;
}

export type DraftSentenceKind = "greeting" | "claim" | "question" | "closing";

export interface DraftSentence {
  text: string;
  kind: DraftSentenceKind;
  facts: string[];
}

/** A fact-checked reply draft; `dropped` keeps what validation removed, so the user sees it. */
export interface Draft {
  offerId: number;
  createdAt: string;
  model: string;
  language: "cs" | "en";
  sentences: DraftSentence[];
  dropped: { text: string; why: string }[];
  text: string;
}

/** Result of crawling an agency website (src/agencies/crawl.ts); all null/false until a judgment ran. */
export interface AgencyCrawl {
  /** True only with a verified verbatim quote proving a web-dev role is open right now. */
  devPositionOpen: boolean;
  /** Open role title, or null. */
  positionTitle: string | null;
  /** One of the fetched page URLs, or null when the model URL fails validation. */
  positionUrl: string | null;
  /** Verbatim quote from the fetched page text proving the open role, or null. */
  evidenceQuote: string | null;
  /** Contract form of the open role; null when no judgment ran yet. */
  form: AgencyForm | null;
  /** Developer pay as stated (never a client price); null when unstated or unverifiable. */
  devRate: string | null;
  /** Role is remote or in Olomouc. */
  remoteOrOlomouc: boolean;
  /** Loose 0-10 fit from the agency rubric; null when no judgment ran yet. */
  aiFit: number | null;
  /** One Czech sentence explaining the fit; null when no judgment ran yet. */
  aiReason: string | null;
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
