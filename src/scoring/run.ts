import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { offersToScore, saveScore } from "../repo";
import { defaultPostJson, scoreOneOffer, type PostJson } from "./client";

export interface RunScoringOptions {
  profile: string;
  model: string;
  endpoint: string;
  maxDescriptionChars: number;
  apiKey: string;
  sessionId: string;
  limit?: number;
  now?: () => string;
  postJson?: PostJson;
}

export interface ScoringSummary {
  scored: number;
  failed: number;
  skipped: number;
  wallMs: number;
  promptTokens: number;
  completionTokens: number;
  fallbackUsed: boolean;
}

const MAX_CONCURRENT_SCORES = 4;

/** Score identity: the profile text plus the model that produced it. Same profile + different model = re-score. */
export const profileHashOf = (profile: string, model?: string): string =>
  createHash("sha256").update(profile + "\nmodel:" + (model ?? "")).digest("hex");

/**
 * Scores offers missing a score for this profile hash, at most 4 LLM calls at a time.
 * One failure is counted and logged; exit code 1 only if every call failed.
 */
export async function runScoring(db: Database, opts: RunScoringOptions): Promise<{ summary: ScoringSummary; exitCode: number }> {
  const started = Date.now();
  const profileHash = profileHashOf(opts.profile, opts.model);
  const offers = offersToScore(db, { profileHash, ...(opts.limit === undefined ? {} : { limit: opts.limit }) });
  const skippedRow = db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM offers o WHERE EXISTS
       (SELECT 1 FROM offer_scores s WHERE s.offer_id = o.id AND s.profile_hash = ?)`,
    )
    .get(profileHash) as { n: number };
  const skipped = skippedRow.n;
  const now = opts.now ?? (() => new Date().toISOString());
  const postJson = opts.postJson ?? defaultPostJson;
  let scored = 0;
  let failed = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let fallbackUsed = false;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < offers.length) {
      const offer = offers[next]!;
      next += 1;
      try {
        const r = await scoreOneOffer(
          {
            endpoint: opts.endpoint,
            model: opts.model,
            profile: opts.profile,
            maxDescriptionChars: opts.maxDescriptionChars,
            apiKey: opts.apiKey,
            sessionId: opts.sessionId,
            postJson,
          },
          offer,
        );
        saveScore(db, {
          offerId: offer.id,
          score: r.score,
          reason: r.reason,
          gaps: r.gaps,
          model: opts.model,
          profileHash,
          scoredAt: now(),
          labels: r.labels,
        });
        scored += 1;
        promptTokens += r.promptTokens;
        completionTokens += r.completionTokens;
        if (r.usedFallback) fallbackUsed = true;
      } catch (e) {
        failed += 1;
        console.error(`score failed for offer ${offer.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SCORES, offers.length) }, () => worker()));
  const summary: ScoringSummary = {
    scored,
    failed,
    skipped,
    wallMs: Date.now() - started,
    promptTokens,
    completionTokens,
    fallbackUsed,
  };
  const exitCode = offers.length > 0 && failed === offers.length ? 1 : 0;
  return { summary, exitCode };
}
