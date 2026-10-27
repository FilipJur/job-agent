import { useEffect, useState } from "react";
import { fetchProfile, saveProfile } from "./api";
import { offerCount } from "./format";
import { primaryButton } from "./ui";

export function ProfileView({ onError }: { onError: (message: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchProfile(controller.signal)
      .then((profile) => {
        setText(profile.text);
        setPending(profile.pending);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : "Profil se nepodařilo načíst");
      });
    return () => controller.abort();
  }, [onError]);

  if (text === null) {
    return <p className="py-12 text-muted">Načítám profil…</p>;
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
      <textarea
        className="min-h-96 w-full resize-y rounded-md border border-line bg-surface p-4 font-mono text-sm leading-relaxed text-fg focus-visible:border-signal"
        aria-label="Profil"
        rows={20}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div>
        <button type="button" className={primaryButton} disabled={saving || text.trim() === ""} onClick={() => void save()}>
          Uložit
        </button>
      </div>
      <p className="text-sm text-muted">Čeká na přehodnocení: {offerCount(pending)}</p>
      <p className="text-sm text-muted [&_code]:font-mono [&_code]:text-fg">Přehodnotí se při příštím <code>daily</code> nebo <code>bun run score</code>.</p>
    </section>
  );
}
