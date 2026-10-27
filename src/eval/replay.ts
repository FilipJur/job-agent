import type { Database } from "bun:sqlite";
import { defaultPostJson, scoreOneOffer, type PostJson } from "../scoring/client";
import type { ScoreVerdict } from "../types";
import { labeledOffersToScore, type EvalLabel } from "./labels";
import { computeMetrics, type EvalMetrics } from "./metrics";

export interface ReplayOptions {
  profile: string;
  model: string;
  endpoint: string;
  maxDescriptionChars: number;
  apiKey: string;
  sessionId: string;
  postJson?: PostJson;
}

export interface ReplayItem {
  offerId: number;
  label: EvalLabel;
  score: number;
  verdict: ScoreVerdict;
  reason: string;
  gaps: string;
}

export interface ReplayResult {
  items: ReplayItem[];
  failed: { offerId: number; label: EvalLabel; error: string }[];
  promptTokens: number;
  completionTokens: number;
  /** Over every labeled offer; failed ones count as unscored. */
  metrics: EvalMetrics;
}

const MAX_CONCURRENT_SCORES = 4;

/** Re-scores the labeled offers with `profile` + `model`, at most 4 calls at a time; never writes to the database. */
export async function replayLabeled(db: Database, opts: ReplayOptions): Promise<ReplayResult> {
  const offers = labeledOffersToScore(db);
  const client = {
    endpoint: opts.endpoint,
    model: opts.model,
    profile: opts.profile,
    maxDescriptionChars: opts.maxDescriptionChars,
    apiKey: opts.apiKey,
    sessionId: opts.sessionId,
    postJson: opts.postJson ?? defaultPostJson,
  };
  const results: (ReplayItem | null)[] = offers.map(() => null);
  const failed: ReplayResult["failed"] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < offers.length) {
      const index = next;
      next += 1;
      const offer = offers[index]!;
      try {
        const r = await scoreOneOffer(client, offer);
        results[index] = { offerId: offer.id, label: offer.label, score: r.score, verdict: r.verdict, reason: r.reason, gaps: r.gaps };
        promptTokens += r.promptTokens;
        completionTokens += r.completionTokens;
      } catch (e) {
        failed.push({ offerId: offer.id, label: offer.label, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SCORES, offers.length) }, () => worker()));
  const metrics = computeMetrics(
    offers.map((o, i) => ({ offerId: o.id, label: o.label, score: results[i]?.score ?? null, verdict: results[i]?.verdict ?? null })),
  );
  failed.sort((a, b) => a.offerId - b.offerId);
  return { items: results.filter((r): r is ReplayItem => r !== null), failed, promptTokens, completionTokens, metrics };
}
