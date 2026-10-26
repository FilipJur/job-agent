import { useEffect, useState } from "react";
import { fetchProfile, saveProfile } from "./api";
import { offerCount } from "./format";

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
    return <p className="empty">Načítám profil…</p>;
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
    <section className="profile">
      <textarea
        className="profile-text"
        aria-label="Profil"
        rows={20}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="profile-actions">
        <button type="button" className="filter" disabled={saving || text.trim() === ""} onClick={() => void save()}>
          Uložit
        </button>
      </div>
      <p className="status">Čeká na přehodnocení: {offerCount(pending)}</p>
      <p className="hint">Přehodnotí se při příštím <code>daily</code> nebo <code>bun run score</code>.</p>
    </section>
  );
}
