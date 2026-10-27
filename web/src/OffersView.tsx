import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatSalary, WORKPLACE_LABELS } from "./format";
import { linkButton, meta } from "./ui";
import type { OfferRow, Verdict } from "./types";

interface FeedbackAction {
  verdict: Verdict;
  label: string;
  title: string;
  key: string;
}

const ACTIONS: FeedbackAction[] = [
  { verdict: "up", label: "Hodí se", title: "Dobrá nabídka", key: "u" },
  { verdict: "down", label: "Nehodí se", title: "Špatná nabídka", key: "d" },
  { verdict: "responded", label: "Odpověděl", title: "Odpověděli", key: "r" },
  { verdict: "hidden", label: "Skrýt", title: "Skrýt nabídku", key: "h" },
];

const VERDICT_TAGS: Partial<Record<Verdict, { text: string; className: string }>> = {
  up: { text: "hodí se", className: "text-ok" },
  down: { text: "nehodí se", className: "text-bad" },
  responded: { text: "odpověděl", className: "text-signal" },
  hidden: { text: "skryto", className: "text-faint" },
};

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const, delay: Math.min(index, 8) * 0.025 },
  }),
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

interface OfferRowProps {
  offer: OfferRow;
  index: number;
  selected: boolean;
  pending: boolean;
  onSelect: (id: number) => void;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
}

function OfferItem({ offer, index, selected, pending, onSelect, onFeedback }: OfferRowProps) {
  const salary = formatSalary(offer);
  const score = offer.score;
  const verdictTag = offer.feedback ? VERDICT_TAGS[offer.feedback.verdict] : undefined;
  return (
    <motion.article
      className="group/row relative grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-line py-4 pr-2 pl-3 transition-colors before:absolute before:top-3 before:bottom-3 before:left-0 before:w-0.5 before:origin-center before:scale-y-0 before:bg-signal before:transition-transform hover:bg-surface/60 data-[selected=true]:bg-surface data-[selected=true]:before:scale-y-100 @xl:grid-cols-[3rem_1fr_9rem] @xl:gap-x-5"
      data-selected={selected}
      data-offer-id={offer.id}
      layout="position"
      custom={index}
      variants={rowVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a,button")) onSelect(offer.id);
      }}
    >
      <div
        className="grid content-start justify-items-start gap-1.5 pt-px"
        style={score ? ({ "--s": score.score } as CSSProperties) : undefined}
        role="img"
        aria-label={score ? `Skóre ${score.score} z 10` : "Nehodnoceno"}
      >
        <span className={`trim font-mono text-2xl leading-none font-medium tabular-nums ${score ? "score-ink" : "text-faint"}`}>
          {score ? score.score : "–"}
        </span>
        <span className="relative h-[3px] w-8 bg-line">
          {score && <span className="score-fill absolute inset-y-0 left-0" style={{ width: `calc(var(--s) * 10%)` }} />}
        </span>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <h2 className="text-base leading-snug font-semibold text-balance">
          <a
            className="text-fg no-underline decoration-signal hover:underline"
            href={offer.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {offer.title}
          </a>
        </h2>

        <p className={meta}>
          {offer.company !== null && <span className="font-medium text-fg">{offer.company}</span>}
          <span>{offer.city ?? "bez města"}</span>
          <span>{WORKPLACE_LABELS[offer.workplace]}</span>
          {salary !== null && <span className="font-mono text-[0.8125rem] text-fg/80">{salary}</span>}
          {offer.partial && <span className="text-signal">neúplný inzerát</span>}
          {verdictTag && <span className={verdictTag.className}>{verdictTag.text}</span>}
        </p>

        {score !== null && score.reason.length > 0 && <p className="max-w-prose text-[0.9375rem] text-fg/85 text-pretty">{score.reason}</p>}
        {score !== null && score.gaps.length > 0 && (
          <p className="max-w-prose text-sm text-muted text-pretty">
            <span className="text-faint">chybí: </span>
            {score.gaps}
          </p>
        )}

        {offer.labels.length > 0 && (
          <ul className="flex flex-wrap gap-x-2.5 font-mono text-xs text-faint" aria-label="Štítky">
            {offer.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}

        {offer.feedback?.reason != null && offer.feedback.reason.length > 0 && (
          <p className="text-sm text-muted">Poznámka: {offer.feedback.reason}</p>
        )}

        <div
          className="-ml-1.5 flex flex-wrap gap-0.5 pt-1 transition-opacity @xl:absolute @xl:right-2 @xl:bottom-2.5 @xl:ml-0 @xl:bg-surface @xl:pt-0 @xl:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100"
          role="group"
          aria-label="Reakce na nabídku"
        >
          {ACTIONS.map((action) => {
            const active = offer.feedback?.verdict === action.verdict;
            return (
              <button
                key={action.verdict}
                type="button"
                className="inline-flex items-baseline gap-1.5 rounded-sm px-1.5 py-1 text-sm text-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-50 aria-pressed:bg-fg aria-pressed:text-bg"
                aria-pressed={active}
                aria-label={action.title}
                title={`${action.title} (${action.key})`}
                disabled={pending}
                onClick={() => onFeedback(offer, action.verdict)}
              >
                {action.label}
                {selected && <kbd className="hidden font-mono text-[0.6875rem] text-faint [@media(hover:hover)_and_(pointer:fine)]:inline">{action.key}</kbd>}
              </button>
            );
          })}
        </div>
      </div>

      <p className="col-start-2 mt-1 flex gap-2 font-mono text-xs text-faint @xl:col-start-3 @xl:row-start-1 @xl:mt-0 @xl:grid @xl:content-start @xl:justify-items-end @xl:gap-0.5 @xl:text-right">
        <span>{offer.source}</span>
        <span title={formatDateTime(offer.firstSeenAt)}>{formatDate(offer.firstSeenAt)}</span>
      </p>
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

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function OffersView({ offers, totalLoaded, pendingId, onFeedback, onReset }: OffersViewProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const lastIndex = useRef(0);

  const selectedIndex = offers.findIndex((offer) => offer.id === selectedId);
  if (selectedIndex >= 0) lastIndex.current = selectedIndex;

  // A selected row that disappears (hidden, filtered out) hands the selection to its neighbour.
  useEffect(() => {
    if (selectedId !== null && selectedIndex < 0) {
      setSelectedId(offers[Math.min(lastIndex.current, offers.length - 1)]?.id ?? null);
    }
  }, [offers, selectedId, selectedIndex]);

  const selectedOffer = selectedIndex >= 0 ? offers[selectedIndex] : undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search]")?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (isTyping(event.target)) (event.target as HTMLElement).blur();
        else setSelectedId(null);
        return;
      }
      if (isTyping(event.target) || offers.length === 0) return;

      const move = (to: number) => {
        const next = offers[Math.max(0, Math.min(offers.length - 1, to))];
        if (next === undefined) return;
        setSelectedId(next.id);
        document.querySelector(`[data-offer-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const current = selectedIndex >= 0 ? selectedIndex : -1;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(current + 1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(current < 0 ? 0 : current - 1);
      } else if (selectedOffer !== undefined && pendingId === null) {
        const action = ACTIONS.find((candidate) => candidate.key === event.key);
        if (action) onFeedback(selectedOffer, action.verdict);
        else if (event.key === "o" || event.key === "Enter") window.open(selectedOffer.url, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [offers, selectedIndex, selectedOffer, pendingId, onFeedback]);

  return (
    <>
      <div className="relative @container">
        <AnimatePresence mode="popLayout" initial>
          {offers.map((offer, index) => (
            <OfferItem
              key={offer.id}
              offer={offer}
              index={index}
              selected={offer.id === selectedId}
              pending={pendingId === offer.id}
              onSelect={setSelectedId}
              onFeedback={onFeedback}
            />
          ))}
        </AnimatePresence>
      </div>
      {offers.length === 0 && (
        <div className="grid max-w-md gap-2 py-12 text-muted">
          {totalLoaded === 0 ? (
            <p>Tady zatím nic není. Nabídky se objeví po dalším běhu <code className="font-mono text-fg">collect</code>.</p>
          ) : (
            <>
              <p>Tahle kombinace filtrů nic nenašla. Zkus ubrat štítek nebo snížit minimální skóre.</p>
              <button type="button" className={`${linkButton} justify-self-start`} onClick={onReset}>
                Zrušit filtry
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
