import type { ScoreVerdict } from "../types";
import type { EvalLabel } from "./labels";

export interface EvalItem {
  offerId: number;
  label: EvalLabel;
  score: number | null;
  verdict: ScoreVerdict | null;
}

export interface Disagreement {
  offerId: number;
  label: "positive" | "negative";
  score: number;
  /** How far the score sits on the wrong side of 5: 5 − score for positives, score − 5 for negatives. */
  severity: number;
}

export interface EvalMetrics {
  n: number;
  positives: number;
  negatives: number;
  aspirations: number;
  unscored: number;
  /** ROC AUC of the score separating positives from negatives (ties 0.5); null when a class has no scored offer. */
  auc: number | null;
  meanScore: Record<EvalLabel, number | null>;
  /** Share of non-negative labels among the k highest-scored offers; null when fewer than k are scored. */
  precisionAt: { 5: number | null; 10: number | null };
  /** Model verdict × user label counts, scored offers only. */
  verdictMatrix: Record<ScoreVerdict, Record<EvalLabel, number>>;
  /** Up to 10 positives scored below 5 and negatives scored above 5, worst first. */
  disagreements: Disagreement[];
}

const MAX_DISAGREEMENTS = 10;

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

function auc(pos: number[], neg: number[]): number | null {
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function precisionAt(scored: (EvalItem & { score: number })[], k: number): number | null {
  if (scored.length < k) return null;
  return scored.slice(0, k).filter((i) => i.label !== "negative").length / k;
}

export function computeMetrics(items: EvalItem[]): EvalMetrics {
  const scored = items
    .filter((i): i is EvalItem & { score: number } => i.score !== null)
    .sort((a, b) => b.score - a.score || a.offerId - b.offerId);
  const scoresOf = (label: EvalLabel) => scored.filter((i) => i.label === label).map((i) => i.score);
  const pos = scoresOf("positive");
  const neg = scoresOf("negative");

  const emptyRow = (): Record<EvalLabel, number> => ({ positive: 0, negative: 0, aspiration: 0 });
  const verdictMatrix: Record<ScoreVerdict, Record<EvalLabel, number>> = {
    fit: emptyRow(),
    blocked: emptyRow(),
    aspiration: emptyRow(),
  };
  for (const i of scored) if (i.verdict !== null) verdictMatrix[i.verdict][i.label] += 1;

  const disagreements: Disagreement[] = [];
  for (const i of scored) {
    if (i.label === "aspiration") continue;
    const severity = i.label === "positive" ? 5 - i.score : i.score - 5;
    if (severity > 0) disagreements.push({ offerId: i.offerId, label: i.label, score: i.score, severity });
  }
  disagreements.sort((a, b) => b.severity - a.severity || a.offerId - b.offerId);

  return {
    n: items.length,
    positives: items.filter((i) => i.label === "positive").length,
    negatives: items.filter((i) => i.label === "negative").length,
    aspirations: items.filter((i) => i.label === "aspiration").length,
    unscored: items.length - scored.length,
    auc: auc(pos, neg),
    meanScore: { positive: mean(pos), negative: mean(neg), aspiration: mean(scoresOf("aspiration")) },
    precisionAt: { 5: precisionAt(scored, 5), 10: precisionAt(scored, 10) },
    verdictMatrix,
    disagreements: disagreements.slice(0, MAX_DISAGREEMENTS),
  };
}
