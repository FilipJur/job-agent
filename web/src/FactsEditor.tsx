import { useCallback, useEffect, useState } from "react";
import { fetchFacts, saveFacts } from "./api";
import { fieldLabel, note, primaryButton, tag } from "./ui";
import type { Fact } from "./types";

/**
 * Facts editor: textarea with one `- ` line per fact, PUT on save, numbered
 * F1… preview below. Renders nothing when the backend worker is not merged
 * yet (404), like the proposal panel.
 */
export function FactsEditor({ onError }: { onError: (message: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const status = await fetchFacts(signal);
    if (status === null) {
      setText(null);
      return;
    }
    setText(status.text);
    setFacts(status.facts);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : "Fakta se nepodařilo načíst");
    });
    return () => controller.abort();
  }, [load, onError]);

  if (text === null) return null;

  const save = async () => {
    setSaving(true);
    try {
      const status = await saveFacts(text);
      setText(status.text);
      setFacts(status.facts);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Fakta se nepodařilo uložit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-3" aria-label="Ověřená fakta">
      <fieldset className="border border-line px-3 pb-3 sm:px-4">
        <legend className="text-[0.75rem] font-medium tracking-[0.2em] text-faint uppercase">ověřená fakta</legend>
        <textarea
          className="min-h-48 w-full resize-y bg-transparent text-sm leading-relaxed text-fg outline-none"
          aria-label="Ověřená fakta"
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" className={primaryButton} disabled={saving || text.trim() === ""} onClick={() => void save()}>
          uložit fakta
        </button>
        <p className={`${note} text-sm text-muted`}>Každý řádek začínající „- “ je fakt, který smí odpověď tvrdit.</p>
      </div>
      {facts.length > 0 && (
        <ol className="grid gap-1" aria-label="Rozpoznané fakty">
          {facts.map((fact) => (
            <li key={fact.id} className="flex flex-wrap items-baseline gap-x-[1.5ch] text-sm">
              <span className={`${tag} text-signal`}>{fact.id}</span>
              <span className="min-w-[20ch] flex-1 text-fg/90 text-pretty">{fact.text}</span>
            </li>
          ))}
        </ol>
      )}
      {facts.length === 0 && (
        <p className={`${note} text-sm text-muted`} aria-label="Žádné rozpoznané fakty">
          (žádný řádek „- “ — návrh nepůjde vygenerovat)
        </p>
      )}
      <p className={fieldLabel}>fakta · {facts.length}</p>
    </section>
  );
}
