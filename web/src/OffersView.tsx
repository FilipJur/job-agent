import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { fetchApplications, removeApplication, saveApplication } from "./api";
import { DraftPanel } from "./DraftPanel";
import { formatDate, formatDateTime, formatSalary, toDateInput, WORKPLACE_LABELS } from "./format";
import { StageSelect } from "./PipelineView";
import { control, fieldLabel, linkButton, meta, note, tag } from "./ui";
import type { Application, AppStage, OfferRow, Verdict } from "./types";

interface FeedbackAction {
  verdict: Verdict;
  label: string;
  title: string;
  key: string;
}

export const ACTIONS: FeedbackAction[] = [
  { verdict: "up", label: "hodí se", title: "Dobrá nabídka", key: "u" },
  { verdict: "down", label: "nehodí se", title: "Špatná nabídka", key: "d" },
  { verdict: "responded", label: "odpověděl", title: "Odpověděli", key: "r" },
  { verdict: "aspiration", label: "aspirace", title: "Přesunout do aspirací", key: "a" },
  { verdict: "hidden", label: "skrýt", title: "Skrýt nabídku", key: "h" },
];

export const VERDICT_TAGS: Partial<Record<Verdict, { text: string; className: string }>> = {
  up: { text: "hodí se", className: "text-ok" },
  down: { text: "nehodí se", className: "text-bad" },
  responded: { text: "odpověděl", className: "text-signal" },
  aspiration: { text: "aspirace", className: "text-signal" },
  hidden: { text: "skryto", className: "text-faint" },
};

interface FeedbackButtonsProps {
  active?: Verdict;
  pending: boolean;
  itemLabel: string;
  onFeedback: (verdict: Verdict) => void;
}

/** Five verdict buttons; clicking the active one clears it again. */
export function FeedbackButtons({ active, pending, itemLabel, onFeedback }: FeedbackButtonsProps) {
  return (
    <div
      className="flex flex-wrap gap-x-[2ch] pt-1 transition-opacity @xl:absolute @xl:right-1 @xl:bottom-2 @xl:bg-raised @xl:pl-2 @xl:pt-0 @xl:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100"
      role="group"
      aria-label={`Reakce na nabídku: ${itemLabel}`}
    >
      {ACTIONS.map((action) => {
        const isActive = active === action.verdict;
        return (
          <button
            key={action.verdict}
            type="button"
            className="text-xs font-medium tracking-[0.1em] text-muted uppercase transition-colors hover:text-signal disabled:opacity-50 aria-pressed:bg-signal aria-pressed:text-bg"
            aria-pressed={isActive}
            aria-label={action.title}
            title={`${action.title} (${action.key})`}
            disabled={pending}
            onClick={() => onFeedback(action.verdict)}
          >
            <span className={isActive ? "" : "text-faint"}>[{action.key}]</span> {action.label}
          </button>
        );
      })}
    </div>
  );
}

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
  onError: (message: string) => void;
  onMissingFacts: () => void;
}

/**
 * Stage control + draft toggle per offer card. The application map loads
 * once per tab render (404 → all controls hidden until the backend lands).
 */
function OfferCopilot({
  offerId,
  offerTitle,
  offerUrl,
  pendingOffer,
  onError,
  onMissingFacts,
}: {
  offerId: number;
  offerTitle: string;
  offerUrl: string;
  pendingOffer: boolean;
  onError: (message: string) => void;
  onMissingFacts: () => void;
}) {
  const [stages, setStages] = useState<Map<number, Application> | null>(null);
  const [saving, setSaving] = useState(false);
  const [nextAction, setNextAction] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const loaded = stages !== null;
  const current = stages?.get(offerId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    fetchApplications(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setStages(new Map((data ?? []).map((row) => [row.offerId, row])));
      })
      .catch(() => {
        // 404 until the backend worker lands: hide the stage controls.
        if (!controller.signal.aborted) setStages(new Map());
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setNextAction(current?.nextActionAt?.slice(0, 10) ?? "");
  }, [current?.nextActionAt]);

  if (!loaded || stages.size === 0) return null;

  const saveStage = async (stage: AppStage | null) => {
    setSaving(true);
    try {
      if (stage === null) {
        await removeApplication(offerId);
        setStages((prev) => {
          const next = new Map(prev ?? []);
          next.delete(offerId);
          return next;
        });
        setNextAction("");
        return;
      }
      const updated = await saveApplication(offerId, { stage });
      setStages((prev) => new Map(prev ?? []).set(offerId, updated));
      setNextAction(updated.nextActionAt?.slice(0, 10) ?? "");
    } finally {
      setSaving(false);
    }
  };

  const saveNextAction = async (value: string) => {
    setNextAction(value);
    if (current === null || current.stage !== "applied") return;
    setSaving(true);
    try {
      const updated = await saveApplication(offerId, { stage: current.stage, nextActionAt: value === "" ? null : value });
      setStages((prev) => new Map(prev ?? []).set(offerId, updated));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-1 pt-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={fieldLabel}>přihláška</span>
        <StageSelect value={current?.stage ?? null} pending={pendingOffer || saving} itemLabel={offerTitle} onChange={(stage) => void saveStage(stage)} />
        {current?.stage === "applied" && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className={fieldLabel}>kdy se ozvat</span>
            <input
              type="date"
              className={`${control} h-7 text-xs`}
              value={nextAction}
              disabled={pendingOffer || saving}
              aria-label={`Další krok pro ${offerTitle}`}
              onChange={(event) => void saveNextAction(event.currentTarget.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="text-xs font-medium tracking-[0.1em] text-muted uppercase transition-colors hover:text-signal"
          aria-expanded={draftOpen}
          onClick={() => setDraftOpen((open) => !open)}
        >
          <span className="text-faint">[{draftOpen ? "–" : "+"}]</span> návrh odpovědi
        </button>
      </div>
      {draftOpen && (
        <DraftPanel offerId={offerId} offerTitle={offerTitle} offerUrl={offerUrl} onError={onError} onMissingFacts={onMissingFacts} />
      )}
    </div>
  );
}

function OfferItem({ offer, selected, pending, onSelect, onFeedback, onError, onMissingFacts }: OfferRowProps) {
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
        {score !== null && score.verdict === "blocked" && offer.feedback === null && (
          <p className="max-w-[84ch] text-sm text-muted text-pretty">
            <span className={`${tag} mr-[1ch] text-bad`}>skryto AI</span>
            {score.blocker.length > 0 ? score.blocker : "model označil nabídku jako nepoužitelnou"}
          </p>
        )}
        {offer.feedback?.verdict === "hidden" && (
          <p className="max-w-[84ch] text-sm text-muted text-pretty">
            <span className={`${tag} mr-[1ch] text-faint`}>skryto tebou</span>
            klikni na jiný verdikt nebo na [h] pro návrat
          </p>
        )}
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

        <OfferCopilot
          offerId={offer.id}
          offerTitle={offer.title}
          offerUrl={offer.url}
          pendingOffer={pending}
          onError={onError}
          onMissingFacts={onMissingFacts}
        />
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
  onError: (message: string) => void;
  onMissingFacts: () => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function OffersView({ offers, totalLoaded, pendingId, onFeedback, onReset, onError, onMissingFacts }: OffersViewProps) {
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
              onError={onError}
              onMissingFacts={onMissingFacts}
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
