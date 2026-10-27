import { useCallback, useEffect, useState } from "react";
import { fetchProfile, saveProfile } from "./api";
import { FactsEditor } from "./FactsEditor";
import { offerCount } from "./format";
import { ProposalPanel } from "./ProposalPanel";
import { primaryButton } from "./ui";

export function ProfileView({ onError }: { onError: (message: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const profile = await fetchProfile(signal);
    setText(profile.text);
    setPending(profile.pending);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : "Profil se nepodařilo načíst");
    });
    return () => controller.abort();
  }, [load, onError]);

  const reload = () => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : "Profil se nepodařilo načíst");
    });
  };

  if (text === null) {
    return <p className="py-10 text-muted">načítám profil…</p>;
  }

  const save = async () => {
    setSaving(true);
    try {
      const profile = await saveProfile(text);
      setText(profile.text);
      setPending(profile.pending);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Profil se nepodařilo uložit");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="grid gap-3">
      <ProposalPanel onError={onError} onApplied={reload} />
      <FactsEditor onError={onError} />
      <fieldset className="border border-line px-3 pb-3 sm:px-4">
        <legend className="text-[0.75rem] font-medium tracking-[0.2em] text-faint uppercase">profile.md</legend>
        <textarea
          className="min-h-96 w-full resize-y bg-transparent text-sm leading-relaxed text-fg outline-none"
          aria-label="Profil"
          rows={20}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </fieldset>
      <div>
        <button type="button" className={primaryButton} disabled={saving || text.trim() === ""} onClick={() => void save()}>
          uložit
        </button>
      </div>
      <p className="text-sm text-muted"><span className="text-[0.75rem] font-medium tracking-[0.16em] text-faint uppercase">čeká na přehodnocení</span> {offerCount(pending)}</p>
      <p className="text-sm text-muted italic [&_code]:text-fg [&_code]:not-italic">přehodnotí se při příštím <code>daily</code> nebo <code>bun run score</code>.</p>
    </section>
  );
}
