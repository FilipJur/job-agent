export type {
  AgencyPatch,
  AgencyRow,
  AspirationRow,
  AgencyStatus,
  FeedbackVerdict,
  OfferRow,
  OfferScore,
  Tab,
  Verdict,
  Workplace,
} from "../../src/types";
export type { TriageOffer, TriageQueue } from "../../src/repo";

export type RateForm = "hpp" | "contract";
export type RatePlace = "olomouc" | "remote" | "praha" | "other" | "all";

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

export interface SkillStat {
  skill: string;
  offers: number;
  fitOffers: number;
  gapMentions: number;
  leverage: number;
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
export type ProposalStatus = "pending" | "applied" | "rejected" | "discarded";

export interface EvalSummary {
  n: number;
  positives: number;
  negatives: number;
  auc: number | null;
  precisionAt5: number | null;
  precisionAt10: number | null;
  meanPositive: number | null;
  meanNegative: number | null;
}

export interface Proposal {
  id: string;
  createdAt: string;
  status: ProposalStatus;
  model: string;
  stale: boolean;
  rationale: string[];
  changes: string[];
  baseProfile: string;
  profile: string;
  metrics: { current: EvalSummary; proposed: EvalSummary };
  /** How the delta was measured; absent on older files (= in-sample). */
  evaluation?: { kind: "holdout" | "in-sample"; n: number };
}

export type AppStage = "drafting" | "applied" | "interview" | "offer" | "rejected" | "withdrawn";

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

export interface Fact {
  id: string;
  text: string;
}

export interface FactsStatus {
  text: string;
  facts: Fact[];
}

export type DraftSentenceKind = "greeting" | "claim" | "question" | "closing";

export interface DraftSentence {
  text: string;
  kind: DraftSentenceKind;
  facts: string[];
}

export interface Draft {
  offerId: number;
  createdAt: string;
  model: string;
  language: "cs" | "en";
  sentences: DraftSentence[];
  dropped: { text: string; why: string }[];
  text: string;
}

export const STAGE_ORDER: AppStage[] = ["drafting", "applied", "interview", "offer", "rejected", "withdrawn"];

export const STAGE_LABELS: Record<AppStage, string> = {
  drafting: "rozpracováno",
  applied: "odesláno",
  interview: "pohovor",
  offer: "nabídka",
  rejected: "zamítnuto",
  withdrawn: "staženo",
};
