import { formatDate, formatDateTime, formatSalary, WORKPLACE_LABELS } from "./format";
import type { OfferRow, Verdict } from "./types";

interface FeedbackAction {
  verdict: Verdict;
  label: string;
  title: string;
}

const ACTIONS: FeedbackAction[] = [
  { verdict: "up", label: "👍", title: "Dobrá nabídka" },
  { verdict: "down", label: "👎", title: "Špatná nabídka" },
  { verdict: "responded", label: "Odpověděl", title: "Odpověděli" },
  { verdict: "hidden", label: "Skrýt", title: "Skrýt nabídku" },
];

const scoreTone = (score: number | undefined): string => {
  if (score === undefined) return "score-none";
  if (score >= 7) return "score-good";
  if (score >= 4) return "score-mid";
  return "score-low";
};

interface OfferCardProps {
  offer: OfferRow;
  pending: boolean;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
}

function OfferCard({ offer, pending, onFeedback }: OfferCardProps) {
  const salary = formatSalary(offer);
  const score = offer.score;
  return (
    <article className="offer">
      <div className="offer-top">
        <h2 className="offer-title">
          <a href={offer.url} target="_blank" rel="noreferrer noopener">
            {offer.title}
          </a>
        </h2>
        <span className={`score ${scoreTone(score?.score)}`}>{score ? `${score.score}/10` : "nehodnoceno"}</span>
      </div>

      <p className="meta">
        {offer.company !== null && <span className="company">{offer.company}</span>}
        <span>{offer.city ?? "bez města"}</span>
        <span>{WORKPLACE_LABELS[offer.workplace]}</span>
        {salary !== null && <span className="salary">{salary}</span>}
      </p>
      <p className="meta meta-sub">
        <span className="source">{offer.source}</span>
        <span title={formatDateTime(offer.firstSeenAt)}>přidáno {formatDate(offer.firstSeenAt)}</span>
        {offer.partial && <span className="partial">neúplný inzerát</span>}
      </p>

      {score !== null && (score.reason.length > 0 || score.gaps.length > 0) && (
        <div className="score-detail">
          {score.reason.length > 0 && <p className="reason">{score.reason}</p>}
          {score.gaps.length > 0 && (
            <p className="gaps">
              <span className="gaps-label">Mezery:</span> {score.gaps}
            </p>
          )}
        </div>
      )}

      {offer.labels.length > 0 && (
        <ul className="labels" aria-label="Štítky">
          {offer.labels.map((label) => (
            <li key={label} className="chip">
              {label}
            </li>
          ))}
        </ul>
      )}

      {offer.feedback?.reason != null && offer.feedback.reason.length > 0 && (
        <p className="feedback-reason">Poznámka: {offer.feedback.reason}</p>
      )}

      <div className="actions" role="group" aria-label="Reakce na nabídku">
        {ACTIONS.map((action) => {
          const active = offer.feedback?.verdict === action.verdict;
          return (
            <button
              key={action.verdict}
              type="button"
              className={active ? "action action-active" : "action"}
              aria-pressed={active}
              aria-label={action.title}
              title={action.title}
              disabled={pending}
              onClick={() => onFeedback(offer, action.verdict)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </article>
  );
}

interface OffersViewProps {
  offers: OfferRow[] | null;
  loading: boolean;
  pendingId: number | null;
  filtersActive: boolean;
  onResetFilters: () => void;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
}

export function OffersView({ offers, loading, pendingId, filtersActive, onResetFilters, onFeedback }: OffersViewProps) {
  if (offers === null) {
    return loading ? <p className="empty">Načítám nabídky…</p> : null;
  }
  if (offers.length === 0) {
    return (
      <div className="empty">
        <p>Žádné nabídky.</p>
        {filtersActive && (
          <button type="button" className="filter-reset" onClick={onResetFilters}>
            Zrušit filtry
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="offers">
      {offers.map((offer) => (
        <OfferCard
          key={offer.id}
          offer={offer}
          pending={pendingId === offer.id}
          onFeedback={onFeedback}
        />
      ))}
    </div>
  );
}
