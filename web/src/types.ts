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
}
