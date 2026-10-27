import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatDateTime, formatSalary, WORKPLACE_LABELS } from "./format";
import { linkButton, meta, note, tag } from "./ui";
import type { OfferRow, Verdict } from "./types";

interface FeedbackAction {
  verdict: Verdict;
  label: string;
  title: string;
  key: string;
}

const ACTIONS: FeedbackAction[] = [
  { verdict: "up", label: "hodí se", title: "Dobrá nabídka", key: "u" },
  { verdict: "down", label: "nehodí se", title: "Špatná nabídka", key: "d" },
  { verdict: "responded", label: "odpověděl", title: "Odpověděli", key: "r" },
  { verdict: "hidden", label: "skrýt", title: "Skrýt nabídku", key: "h" },
];

const VERDICT_TAGS: Partial<Record<Verdict, { text: string; className: string }>> = {
  up: { text: "hodí se", className: "text-ok" },
  down: { text: "nehodí se", className: "text-bad" },
  responded: { text: "odpověděl", className: "text-signal" },
  hidden: { text: "skryto", className: "text-faint" },
};

const rowVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};

/** Ten-cell gauge drawn with box characters: heavy line = score on the ramp colour, light line = dim rail. */
export function ScoreBar({ score }: { score: number | undefined }) {
  const filled = score ?? 0;
  return (
    <span
      className="inline-flex shrink-0 gap-[1ch] whitespace-pre tabular-nums"
      style={score === undefined ? undefined : ({ "--s": score } as CSSProperties)}
      role="img"
      aria-label={score === undefined ? "Nehodnoceno" : `Skóre ${score} z 10`}
    >
      <span className={score === undefined ? "text-faint" : "score-ink text-xl leading-none font-semibold"}>
        {score === undefined ? "--" : String(score).padStart(2, "0")}
      </span>
      <span aria-hidden="true">
        <span className="score-ink">{"━".repeat(filled)}</span>
        <span className="text-line">{"─".repeat(10 - filled)}</span>
      </span>
    </span>
  );
}

interface OfferRowProps {
  offer: OfferRow;
  selected: boolean;
  pending: boolean;
  onSelect: (id: number) => void;
  onFeedback: (offer: OfferRow, verdict: Verdict) => void;
}

function OfferItem({ offer, selected, pending, onSelect, onFeedback }: OfferRowProps) {
  const salary = formatSalary(offer);
  const score = offer.score;
  const verdictTag = offer.feedback ? VERDICT_TAGS[offer.feedback.verdict] : undefined;
  return (
    <motion.article
      className="group/row relative grid grid-cols-[2ch_1fr] gap-x-[1ch] border-b border-line py-3 pr-1 transition-colors before:text-signal before:content-[''] hover:bg-surface data-[selected=true]:bg-raised data-[selected=true]:before:content-['>']"
      data-selected={selected}
      data-offer-id={offer.id}
      layout="position"
      variants={rowVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      transition={{ layout: { duration: 0.12 } }}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a,button")) onSelect(offer.id);
      }}
    >
      <div className="grid min-w-0 gap-1 col-start-2">
        <div className="flex flex-wrap items-baseline gap-x-[2ch] gap-y-0.5">
          <ScoreBar score={score?.score} />
          <h2 className="min-w-[20ch] flex-1 text-[1.125rem] leading-snug font-semibold text-balance">
            <a
              className="text-fg no-underline decoration-signal hover:underline"
              href={offer.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {offer.title}
            </a>
          </h2>
        </div>

        <p className={meta}>
          {offer.company !== null && <span className="font-medium text-fg">{offer.company}</span>}
          <span>{offer.city ?? "bez města"}</span>
          <span>{WORKPLACE_LABELS[offer.workplace]}</span>
          {salary !== null && <span className="text-fg/80">{salary}</span>}
          <span className={`${tag} text-faint`}>{offer.source}</span>
          <span className="text-faint" title={formatDateTime(offer.firstSeenAt)}>
            {formatDate(offer.firstSeenAt)}
          </span>
          {offer.partial && <span className={`${tag} text-bad`}>neúplný inzerát</span>}
          {verdictTag && <span className={`${tag} ${verdictTag.className}`}>{verdictTag.text}</span>}
        </p>

        {score !== null && score.reason.length > 0 && <p className={`${note} max-w-[84ch] text-fg/90 text-pretty`}>{score.reason}</p>}
        {score !== null && score.gaps.length > 0 && (
          <p className="max-w-[84ch] text-sm text-muted text-pretty">
            <span className={`${tag} mr-[1ch] text-faint`}>chybí</span>
            {score.gaps}
          </p>
        )}

        {offer.labels.length > 0 && (
          <ul className="flex flex-wrap gap-x-[1.5ch] text-xs tracking-[0.04em] text-faint" aria-label="Štítky">
            {offer.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}

        {offer.feedback?.reason != null && offer.feedback.reason.length > 0 && (
          <p className="text-sm text-muted"><span className={`${tag} mr-[1ch] text-faint`}>poznámka</span><span className={note}>{offer.feedback.reason}</span></p>
        )}

        <div
          className="flex flex-wrap gap-x-[2ch] pt-1 transition-opacity @xl:absolute @xl:right-1 @xl:bottom-2 @xl:bg-raised @xl:pl-2 @xl:pt-0 @xl:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100"
          role="group"
          aria-label="Reakce na nabídku"
        >
          {ACTIONS.map((action) => {
            const active = offer.feedback?.verdict === action.verdict;
            return (
              <button
                key={action.verdict}
                type="button"
                className="text-xs font-medium tracking-[0.1em] text-muted uppercase transition-colors hover:text-signal disabled:opacity-50 aria-pressed:bg-signal aria-pressed:text-bg"
                aria-pressed={active}
                aria-label={action.title}
                title={`${action.title} (${action.key})`}
                disabled={pending}
                onClick={() => onFeedback(offer, action.verdict)}
              >
                <span className={active ? "" : "text-faint"}>[{action.key}]</span> {action.label}
              </button>
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
      <div className="relative border-t border-line @container">
        <AnimatePresence mode="popLayout" initial>
          {offers.map((offer) => (
            <OfferItem
              key={offer.id}
              offer={offer}
              selected={offer.id === selectedId}
              pending={pendingId === offer.id}
              onSelect={setSelectedId}
              onFeedback={onFeedback}
            />
          ))}
        </AnimatePresence>
      </div>
      {offers.length === 0 && (
        <div className="grid max-w-[60ch] gap-2 py-10 text-muted">
          {totalLoaded === 0 ? (
            <p>$ ls nabídky/ <br /><span className={note}>(prázdné) Nabídky se objeví po dalším běhu <code className="not-italic text-fg">collect</code>.</span></p>
          ) : (
            <>
              <p><span className={`${tag} text-faint`}>0 výsledků</span><br /><span className={note}>Zkus ubrat štítek nebo snížit minimální skóre.</span></p>
              <button type="button" className={`${linkButton} ${tag} justify-self-start`} onClick={onReset}>
                zrušit filtry
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
