import { useCallback, useEffect, useRef, useState } from "react";
import { clearVerdict, fetchTriage, sendVerdict } from "./api";
import { formatDate, formatDateTime, formatSalary, WORKPLACE_LABELS } from "./format";
import { checkbox, fieldLabel, linkButton, meta, note, tag } from "./ui";
import { ScoreBar } from "./OffersView";
import type { TriageOffer, Verdict } from "./types";

interface VerdictAction {
  verdict: Verdict;
  label: string;
  title: string;
  key: string;
}

const VERDICT_ACTIONS: VerdictAction[] = [
  { verdict: "up", label: "hodí se", title: "Dobrá nabídka", key: "1" },
  { verdict: "down", label: "nehodí se", title: "Špatná nabídka", key: "2" },
  { verdict: "aspiration", label: "aspirace", title: "Přesunout do aspirací", key: "3" },
  { verdict: "hidden", label: "skrýt", title: "Skrýt nabídku", key: "h" },
];

const CHIPS: { key: string; label: string }[] = [
  { key: "q", label: "seniorita" },
  { key: "w", label: "lokalita" },
  { key: "e", label: "stack" },
  { key: "r", label: "forma" },
  { key: "t", label: "obor" },
  { key: "y", label: "plat" },
  { key: "u", label: "firma" },
];

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const joinReason = (chips: string[], text: string): string | undefined => {
  const parts = [...chips];
  const free = text.trim();
  if (free.length > 0) parts.push(free);
  return parts.length > 0 ? parts.join("; ") : undefined;
};

interface CardProps {
  offer: TriageOffer;
  chips: string[];
  freeText: string;
  pending: boolean;
  onToggleChip: (label: string) => void;
  onFreeText: (value: string) => void;
  onVerdict: (verdict: Verdict) => void;
  onSkip: () => void;
}

function TriageCard({ offer, chips, freeText, pending, onToggleChip, onFreeText, onVerdict, onSkip }: CardProps) {
  const salary = formatSalary(offer);
  const score = offer.score;
  return (
    <article className="border border-line bg-surface px-4 py-4 sm:px-5" data-triage-id={offer.id} aria-label={`Triáž: ${offer.title}`}>
      <div className="flex flex-wrap items-baseline gap-x-[2ch] gap-y-0.5">
        <ScoreBar score={score?.score} />
        <h2 className="min-w-[20ch] flex-1 text-[1.25rem] leading-snug font-semibold text-balance">
          <a href={offer.url} target="_blank" rel="noreferrer noopener">
            {offer.title}
          </a>
        </h2>
      </div>

      <p className={`${meta} mt-2`}>
        {offer.company !== null && <span className="font-medium text-fg">{offer.company}</span>}
        <span>{offer.city ?? "bez města"}</span>
        <span>{WORKPLACE_LABELS[offer.workplace]}</span>
        {salary !== null && <span className="text-fg/80">{salary}</span>}
        <span className={`${tag} text-faint`}>{offer.source}</span>
        <span className="text-faint" title={formatDateTime(offer.firstSeenAt)}>
          {formatDate(offer.firstSeenAt)}
        </span>
        {offer.partial && <span className={`${tag} text-bad`}>neúplný inzerát</span>}
      </p>

      {offer.labels.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-[1.5ch] text-xs tracking-[0.04em] text-faint" aria-label="Štítky">
          {offer.labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}

      {score !== null && (
        <div className="mt-3 grid max-w-[84ch] gap-1">
          {score.reason.length > 0 && <p className={`${note} text-fg/90 text-pretty`}>{score.reason}</p>}
          {score.gaps.length > 0 && (
            <p className="text-sm text-muted text-pretty">
              <span className={`${tag} mr-[1ch] text-faint`}>chybí</span>
              {score.gaps}
            </p>
          )}
        </div>
      )}

      {offer.excerpt.length > 0 && (
        <p className="mt-3 max-w-[84ch] text-sm text-muted text-pretty">
          <span className={`${tag} mr-[1ch] text-faint`}>perex</span>
          {offer.excerpt}
        </p>
      )}

      <fieldset className="mt-4 border border-line px-3 pt-0 pb-3" aria-label="Důvod verdiktu">
        <legend className={fieldLabel}>důvod</legend>
        <div className="flex flex-wrap gap-x-[2ch] gap-y-1">
          {CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={`${checkbox} text-xs tracking-[0.08em] uppercase`}
              aria-pressed={chips.includes(chip.label)}
              title={`${chip.label} (${chip.key})`}
              disabled={pending}
              onClick={() => onToggleChip(chip.label)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="mt-2 h-8 w-full border border-line bg-bg px-2 text-sm text-fg placeholder:text-faint focus-visible:border-signal"
          placeholder="volný text důvodu…"
          value={freeText}
          disabled={pending}
          onChange={(event) => onFreeText(event.target.value)}
          aria-label="Volný text důvodu"
        />
      </fieldset>

      <div className="mt-3 flex flex-wrap gap-x-[2ch] gap-y-2" role="group" aria-label={`Verdikt: ${offer.title}`}>
        {VERDICT_ACTIONS.map((action) => (
          <button
            key={action.verdict}
            type="button"
            className="text-xs font-medium tracking-[0.1em] text-muted uppercase transition-colors hover:text-signal disabled:opacity-50"
            title={`${action.title} (${action.key})`}
            disabled={pending}
            onClick={() => onVerdict(action.verdict)}
          >
            <span className="text-faint">[{action.key}]</span> {action.label}
          </button>
        ))}
        <button
          type="button"
          className="text-xs font-medium tracking-[0.1em] text-muted uppercase transition-colors hover:text-signal disabled:opacity-50"
          title="Přeskočit (s nebo →)"
          disabled={pending}
          onClick={onSkip}
        >
          <span className="text-faint">[s]</span> přeskočit
        </button>
        <a className="text-xs font-medium tracking-[0.1em] uppercase" href={offer.url} target="_blank" rel="noreferrer noopener" title="Otevřít inzerát (o)">
          <span className="text-faint">[o]</span> otevřít
        </a>
      </div>
    </article>
  );
}

interface HistoryEntry {
  id: number;
  offer: TriageOffer;
}

export function TriageView({ onError }: { onError: (message: string) => void }) {
  const [queue, setQueue] = useState<TriageOffer[]>([]);
  const [labeled, setLabeled] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const seenIds = useRef(new Set<number>());
  const loadingRef = useRef(false);
  const stateRef = useRef({ queue, labeled, remaining, history, chips, freeText, pending });
  stateRef.current = { queue, labeled, remaining, history, chips, freeText, pending };

  const load = useCallback(
    async (limit: number, signal: AbortSignal, known: Set<number>) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const data = await fetchTriage(limit, signal);
        if (signal.aborted) return;
        const fresh = data.offers.filter((offer) => !known.has(offer.id));
        for (const offer of fresh) known.add(offer.id);
        setQueue((current) => [...current, ...fresh]);
        setLabeled(data.labeled);
        setRemaining(data.remaining);
      } catch (cause) {
        if (!signal.aborted) onError(`Načtení triáže selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        loadingRef.current = false;
        if (!signal.aborted) setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    const controller = new AbortController();
    seenIds.current = new Set();
    setQueue([]);
    setHistory([]);
    setChips([]);
    setFreeText("");
    setLoading(true);
    void load(20, controller.signal, seenIds.current);
    return () => controller.abort();
  }, [load]);

  // Prefetch while fewer than 5 cards remain locally.
  useEffect(() => {
    if (!loading && queue.length > 0 && queue.length < 5) {
      const controller = new AbortController();
      void load(20, controller.signal, seenIds.current);
      return () => controller.abort();
    }
  }, [queue.length, loading, load]);

  const current = queue[0] ?? null;

  const resetReasons = () => {
    setChips([]);
    setFreeText("");
  };

  const answer = useCallback(
    async (verdict: Verdict) => {
      const { queue: q, chips: c, freeText: t } = stateRef.current;
      const offer = q[0];
      if (offer === undefined || stateRef.current.pending) return;
      setPending(true);
      setQueue(q.slice(1));
      setHistory((h) => [...h, { id: offer.id, offer }]);
      resetReasons();
      try {
        await sendVerdict(offer.id, verdict, joinReason(c, t));
        setLabeled((n) => n + 1);
        setRemaining((n) => Math.max(0, n - 1));
      } catch (cause) {
        // Put the card back on failure.
        setQueue((rest) => [offer, ...rest]);
        setHistory((h) => h.filter((entry) => entry.id !== offer.id));
        onError(`Uložení verdiktu selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        setPending(false);
      }
    },
    [onError],
  );

  const skip = useCallback(() => {
    const { queue: q } = stateRef.current;
    if (q[0] === undefined || stateRef.current.pending) return;
    setQueue([...q.slice(1), q[0]!]);
    resetReasons();
  }, []);

  const undo = useCallback(async () => {
    const { history: h } = stateRef.current;
    const last = h[h.length - 1];
    if (last === undefined || stateRef.current.pending) return;
    setPending(true);
    try {
      await clearVerdict(last.id);
      setQueue((q) => [last.offer, ...q]);
      setHistory(h.slice(0, -1));
      setLabeled((n) => Math.max(0, n - 1));
      setRemaining((n) => n + 1);
    } catch (cause) {
      onError(`Vrácení verdiktu selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(false);
    }
  }, [onError]);

  const toggleChip = useCallback((label: string) => {
    setChips((current) => (current.includes(label) ? current.filter((c) => c !== label) : [...current, label]));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        if (isTyping(event.target)) (event.target as HTMLElement).blur();
        return;
      }
      if (isTyping(event.target)) return;
      const key = event.key;
      const chip = CHIPS.find((c) => c.key === key);
      if (chip) {
        event.preventDefault();
        toggleChip(chip.label);
        return;
      }
      if (key === "1") void answer("up");
      else if (key === "2") void answer("down");
      else if (key === "3") void answer("aspiration");
      else if (key === "h") void answer("hidden");
      else if (key === "s" || key === "ArrowRight") {
        event.preventDefault();
        skip();
      } else if (key === "o") {
        const offer = stateRef.current.queue[0];
        if (offer) window.open(offer.url, "_blank", "noopener,noreferrer");
      } else if (key === "z") void undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, skip, undo, toggleChip]);

  return (
    <div>
      <p className="mb-4 text-sm text-muted tabular-nums" aria-live="polite">
        {loading && queue.length === 0 ? "načítám…" : `označeno ${labeled} · zbývá ${remaining}`}
      </p>
      {current !== null ? (
        <TriageCard
          offer={current}
          chips={chips}
          freeText={freeText}
          pending={pending}
          onToggleChip={toggleChip}
          onFreeText={setFreeText}
          onVerdict={(verdict) => void answer(verdict)}
          onSkip={skip}
        />
      ) : (
        !loading && (
          <p className="grid max-w-[60ch] gap-2 py-10 text-muted">
            $ triage/ <br />
            <span className={note}>(hotovo) Všechny nabídky mají verdikt. Nové přibudou po dalším běhu collect.</span>
            {history.length > 0 && (
              <button type="button" className={`${linkButton} justify-self-start`} onClick={() => void undo()} disabled={pending}>
                [z] vrátit poslední verdikt
              </button>
            )}
          </p>
        )
      )}
      {history.length > 0 && current !== null && (
        <p className="mt-4 text-sm text-faint">
          <button type="button" className={linkButton} onClick={() => void undo()} disabled={pending} title="Vrátit poslední verdikt (z)">
            [z] vrátit poslední ({history.length})
          </button>
        </p>
      )}
    </div>
  );
}
