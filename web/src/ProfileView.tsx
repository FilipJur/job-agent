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
      <fieldset className="border border-line px-3 pb-3 sm:px-4">
        <legend className="text-xs text-faint">profile.md</legend>
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
      <p className="text-sm text-muted">čeká na přehodnocení: {offerCount(pending)}</p>
      <p className="text-sm text-muted [&_code]:text-fg">přehodnotí se při příštím <code>daily</code> nebo <code>bun run score</code>.</p>
    </section>
  );
}
