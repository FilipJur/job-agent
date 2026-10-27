import { useEffect, useState } from "react";
import { fetchDraft, fetchFacts, generateDraft } from "./api";
import { fieldLabel, linkButton, note, primaryButton, tag } from "./ui";
import type { Draft, Fact } from "./types";

interface DraftPanelProps {
  offerId: number;
  offerTitle: string;
  offerUrl: string;
  onError: (message: string) => void;
  onMissingFacts: () => void;
}

const KIND_LABELS = { greeting: "pozdrav", claim: "tvrzení", question: "otázka", closing: "závěr" } as const;

/** "F1" chips: hover/tap reveals the fact text from /api/facts via the title tooltip. */
function FactChips({ ids, facts }: { ids: string[]; facts: Map<string, string> }) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-[1ch]">
      {ids.map((id) => (
        <span key={id} className={`${tag} cursor-help text-signal`} title={facts.get(id) ?? "(fakt nenalezen)"}>
          {id}
        </span>
      ))}
    </span>
  );
}

export function DraftPanel({ offerId, offerTitle, offerUrl, onError, onMissingFacts }: DraftPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [facts, setFacts] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [factsEmpty, setFactsEmpty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    setFactsEmpty(false);
    setDraft(null);
    Promise.all([fetchDraft(offerId, controller.signal), fetchFacts(controller.signal)])
      .then(([loaded, status]) => {
        if (controller.signal.aborted) return;
        setDraft(loaded);
        setFacts(new Map((status?.facts ?? []).map((fact: Fact) => [fact.id, fact.text])));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setFailure(message);
          onError(`Načtení návrhu selhalo: ${message}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offerId, onError]);

  const generate = async () => {
    setGenerating(true);
    setFailure(null);
    setFactsEmpty(false);
    const controller = new AbortController();
    try {
      const created = await generateDraft(offerId, controller.signal);
      setDraft(created);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      // 409 = no facts: link to the facts editor in the Profil tab.
      if (/fakt/i.test(message)) {
        setFactsEmpty(true);
      } else {
        setFailure(message);
        onError(`Generování návrhu selhalo: ${message}`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (draft === null) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (cause) {
      onError(`Kopírování selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return (
    <section className="mt-3 border border-line bg-surface px-3 py-3 sm:px-4" aria-label={`Návrh odpovědi: ${offerTitle}`}>
      <p className={fieldLabel}>návrh odpovědi</p>
      {loading && <p className="mt-2 text-sm text-muted">načítám návrh…</p>}
      {!loading && failure !== null && (
        <p className="mt-2 text-sm text-bad" role="alert">
          {failure}{" "}
          <button type="button" className={linkButton} onClick={() => void generate()}>
            [zkusit znovu]
          </button>
        </p>
      )}
      {!loading && failure === null && draft === null && !factsEmpty && (
        <div className="mt-2 grid gap-2">
          <p className={`${note} text-sm text-muted`}>zatím žádný návrh — vygeneruje se z ověřených faktů, trvá 10–40 s</p>
          <p>
            <button type="button" className={primaryButton} disabled={generating} onClick={() => void generate()}>
              {generating ? "generuji…" : "vygenerovat"}
            </button>
          </p>
        </div>
      )}
      {generating && <p className="mt-2 text-sm text-muted tabular-nums" aria-live="polite">generuji z faktů… (10–40 s)</p>}
      {factsEmpty && (
        <p className="mt-2 text-sm text-muted" role="alert">
          <span className={`${tag} mr-[1ch] text-bad`}>chybí fakta</span>
          nejdřív vyplň ověřená fakta v{" "}
          <button type="button" className={linkButton} onClick={onMissingFacts}>
            profilu
          </button>
        </p>
      )}
      {draft !== null && (
        <div className="mt-2 grid gap-3">
          <div className="flex flex-wrap items-center gap-x-[2ch] gap-y-1 text-xs text-faint">
            <span className={tag}>{draft.language === "cs" ? "česky" : "anglicky"}</span>
            <span>{draft.model}</span>
            <span title={draft.createdAt}>{new Date(draft.createdAt).toLocaleString("cs-CZ")}</span>
            <button type="button" className={linkButton} disabled={generating} onClick={() => void generate()}>
              [znovu]
            </button>
          </div>
          <pre className="max-w-[84ch] border border-line bg-bg px-3 py-2 text-sm whitespace-pre-wrap text-fg">{draft.text}</pre>
          <div className="flex flex-wrap gap-x-[2ch] gap-y-2">
            <button type="button" className={primaryButton} onClick={() => void copy()}>
              {copied ? "zkopírováno ✓" : "kopírovat"}
            </button>
            <a className={primaryButton} href={offerUrl} target="_blank" rel="noreferrer noopener">
              otevřít nabídku ↗
            </a>
          </div>
          <p className={`${note} text-sm text-muted`}>Nic se neodesílá — zkopíruj a pošli sám.</p>
          {draft.sentences.length > 0 && (
            <ol className="grid gap-1.5" aria-label="Věty návrhu s fakty">
              {draft.sentences.map((sentence, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-x-[1.5ch] text-sm">
                  <span className={`${tag} text-faint`}>{KIND_LABELS[sentence.kind]}</span>
                  <span className="min-w-[20ch] flex-1 text-fg/90 text-pretty">{sentence.text}</span>
                  <FactChips ids={sentence.facts} facts={facts} />
                </li>
              ))}
            </ol>
          )}
          {draft.dropped.length > 0 && (
            <div className="grid gap-1">
              <p className={fieldLabel}>vyřazeno kontrolou</p>
              <ul className="grid gap-1">
                {draft.dropped.map((item, index) => (
                  <li key={index} className="text-sm text-faint">
                    <span className="line-through">{item.text}</span>{" "}
                    <span className={`${note} text-muted`}>— {item.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
