import type { Database } from "bun:sqlite";
import type { OfferToScore, ScoreVerdict, Verdict, Workplace } from "../types";

/** The user's verdict collapsed to what the eval measures. */
export type EvalLabel = "positive" | "negative" | "aspiration";

const LABEL_OF: Record<Verdict, EvalLabel> = {
  up: "positive",
  responded: "positive",
  down: "negative",
  hidden: "negative",
  aspiration: "aspiration",
};

export interface StoredScore {
  score: number;
  verdict: ScoreVerdict;
  model: string;
  profileHash: string;
  reason: string;
  gaps: string;
}

export interface LabeledOffer {
  offerId: number;
  title: string;
  company: string | null;
  label: EvalLabel;
  /** The user's feedback reason. */
  reason: string | null;
  /** Latest score row (by `scored_at`, then id); null when the offer was never scored. */
  latestScore: StoredScore | null;
}

/** Latest feedback row per offer, by `created_at` then id (the rule `src/repo.ts` uses); `cleared` means unlabeled. */
const LATEST_FEEDBACK = `JOIN feedback f ON f.offer_id = o.id AND f.verdict <> 'cleared' AND NOT EXISTS (
    SELECT 1 FROM feedback f2 WHERE f2.offer_id = o.id
      AND (f2.created_at > f.created_at OR (f2.created_at = f.created_at AND f2.id > f.id)))`;

const LATEST_SCORE = `LEFT JOIN offer_scores s ON s.offer_id = o.id AND NOT EXISTS (
    SELECT 1 FROM offer_scores s2 WHERE s2.offer_id = o.id
      AND (s2.scored_at > s.scored_at OR (s2.scored_at = s.scored_at AND s2.id > s.id)))`;

interface LabeledRow {
  id: number;
  title: string;
  company: string | null;
  verdict: Verdict;
  feedback_reason: string | null;
  score: number | null;
  score_verdict: ScoreVerdict | null;
  model: string | null;
  profile_hash: string | null;
  score_reason: string | null;
  gaps: string | null;
}

/** Offers whose latest feedback is a verdict (not `cleared`), with their latest stored score; ordered by offer id. */
export function labeledOffers(db: Database): LabeledOffer[] {
  const rows = db
    .query<LabeledRow, []>(
      `SELECT o.id, o.title, o.company, f.verdict, f.reason AS feedback_reason,
        s.score, s.verdict AS score_verdict, s.model, s.profile_hash, s.reason AS score_reason, s.gaps
      FROM offers o
      ${LATEST_FEEDBACK}
      ${LATEST_SCORE}
      ORDER BY o.id`,
    )
    .all();
  return rows.map((r) => ({
    offerId: r.id,
    title: r.title,
    company: r.company,
    label: LABEL_OF[r.verdict],
    reason: r.feedback_reason,
    latestScore:
      r.score === null
        ? null
        : {
            score: r.score,
            verdict: r.score_verdict ?? "fit",
            model: r.model ?? "",
            profileHash: r.profile_hash ?? "",
            reason: r.score_reason ?? "",
            gaps: r.gaps ?? "",
          },
  }));
}

interface ToScoreRow {
  id: number;
  title: string;
  company: string | null;
  location_text: string | null;
  city: string | null;
  workplace: Workplace;
  description: string;
  verdict: Verdict;
}

/** The labeled offers in the shape `scoreOneOffer` takes, labels sorted like `offersToScore`; ordered by offer id. */
export function labeledOffersToScore(db: Database): (OfferToScore & { label: EvalLabel })[] {
  const rows = db
    .query<ToScoreRow, []>(
      `SELECT o.id, o.title, o.company, o.location_text, o.city, o.workplace, o.description, f.verdict
      FROM offers o
      ${LATEST_FEEDBACK}
      ORDER BY o.id`,
    )
    .all();
  const labels = new Map<number, string[]>();
  const labelRows = db
    .query<{ offer_id: number; label: string }, []>(
      `SELECT l.offer_id, l.label FROM offer_labels l
      JOIN offers o ON o.id = l.offer_id
      ${LATEST_FEEDBACK}
      ORDER BY l.label`,
    )
    .all();
  for (const row of labelRows) {
    const list = labels.get(row.offer_id);
    if (list) list.push(row.label);
    else labels.set(row.offer_id, [row.label]);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    locationText: r.location_text,
    city: r.city,
    workplace: r.workplace,
    description: r.description,
    labels: labels.get(r.id) ?? [],
    label: LABEL_OF[r.verdict],
  }));
}
