import { AnimatePresence, motion } from "motion/react";
import { formatDate, formatDateTime, formatSalary, WORKPLACE_LABELS } from "./format";
import { linkButton, meta } from "./ui";
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

/** Sets `--tone`, which the card's accent rail and score numeral read. */
const scoreTone = (score: number | undefined): string => {
  if (score === undefined) return "[--tone:var(--color-line)]";
  if (score >= 7) return "[--tone:var(--color-good)]";
  if (score >= 4) return "[--tone:var(--color-mid)]";
  return "[--tone:var(--color-low)]";
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const, delay: Math.min(index, 8) * 0.03 },
  }),
  exit: { opacity: 0, scale: 0.985, transition: { duration: 0.14 } },
};

interface OfferCardProps {
  offer: OfferRow;
  index: number;
  pending: boolean;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
}

function OfferCard({ offer, index, pending, onFeedback }: OfferCardProps) {
  const salary = formatSalary(offer);
  const score = offer.score;
  return (
    <motion.article
      className={`grid grid-cols-[2.75rem_1fr] gap-x-3 rounded-xl border border-l-[3px] border-line border-l-(--tone) bg-surface p-4 @xl:grid-cols-[4rem_1fr] @xl:gap-x-5 ${scoreTone(score?.score)}`}
      layout="position"
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <div
        className="flex flex-col items-center pt-0.5 leading-none"
        aria-label={score ? `Skóre ${score.score} z 10` : "Nehodnoceno"}
      >
        <span className="font-display text-3xl text-(--tone) tabular-nums @xl:text-5xl">{score ? score.score : "–"}</span>
        <span className="mt-1 font-mono text-[0.65rem] text-muted">{score ? "/10" : "n/a"}</span>
      </div>

      <div className="grid min-w-0 gap-2">
        <h2 className="font-display text-lg leading-snug font-medium text-balance @xl:text-xl">
          <a
            className="text-fg no-underline decoration-accent/50 underline-offset-4 transition-colors hover:text-accent hover:underline"
            href={offer.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {offer.title}
          </a>
        </h2>

        <p className={meta}>
          {offer.company !== null && <span className="font-semibold text-fg">{offer.company}</span>}
          <span>{offer.city ?? "bez města"}</span>
          <span>{WORKPLACE_LABELS[offer.workplace]}</span>
          {salary !== null && <span className="font-mono text-good">{salary}</span>}
        </p>
        <p className={`${meta} text-xs`}>
          <span className="font-mono">{offer.source}</span>
          <span title={formatDateTime(offer.firstSeenAt)}>přidáno {formatDate(offer.firstSeenAt)}</span>
          {offer.partial && <span className="text-mid">neúplný inzerát</span>}
        </p>

        {score !== null && (score.reason.length > 0 || score.gaps.length > 0) && (
          <div className="grid gap-1.5 border-t border-line/70 pt-2.5 text-[0.95rem] text-pretty">
            {score.reason.length > 0 && <p className="text-fg/90">{score.reason}</p>}
            {score.gaps.length > 0 && (
              <p className="text-sm text-muted">
                <span className="mr-1 text-[0.65rem] font-semibold tracking-widest text-low uppercase">Mezery</span>
                {score.gaps}
              </p>
            )}
          </div>
        )}

        {offer.labels.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Štítky">
            {offer.labels.map((label) => (
              <li key={label} className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.7rem] text-muted">
                {label}
              </li>
            ))}
          </ul>
        )}

        {offer.feedback?.reason != null && offer.feedback.reason.length > 0 && (
          <p className="text-sm text-muted italic">Poznámka: {offer.feedback.reason}</p>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Reakce na nabídku">
          {ACTIONS.map((action) => {
            const active = offer.feedback?.verdict === action.verdict;
            return (
              <motion.button
                key={action.verdict}
                type="button"
                className="h-8 rounded-md border border-line bg-raised px-3 text-sm transition-colors hover:border-accent disabled:opacity-50 aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent"
                aria-pressed={active}
                aria-label={action.title}
                title={action.title}
                disabled={pending}
                whileTap={{ scale: 0.9 }}
                animate={{ scale: active ? [1, 1.14, 1] : 1 }}
                transition={{ duration: 0.25 }}
                onClick={() => onFeedback(offer, action.verdict)}
              >
                {action.label}
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.article>
  );
}

interface OffersViewProps {
  offers: OfferRow[];
  /** Total loaded before client-side filters; 0 means the tab itself is empty. */
  totalLoaded: number;
  pendingId: number | null;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
  onReset: () => void;
}

export function OffersView({ offers, totalLoaded, pendingId, onFeedback, onReset }: OffersViewProps) {
  return (
    <>
      <div className="relative grid gap-3 @container">
        <AnimatePresence mode="popLayout" initial>
          {offers.map((offer, index) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              index={index}
              pending={pendingId === offer.id}
              onFeedback={onFeedback}
            />
          ))}
        </AnimatePresence>
      </div>
      {offers.length === 0 && (
        <div className="grid justify-items-center gap-2 py-16 text-muted">
          <p>{totalLoaded === 0 ? "Žádné nabídky." : "Žádná nabídka neodpovídá filtrům."}</p>
          {totalLoaded > 0 && (
            <button type="button" className={linkButton} onClick={onReset}>
              Zrušit filtry
            </button>
          )}
        </div>
      )}
    </>
  );
}
