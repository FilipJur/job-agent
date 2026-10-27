import { useEffect } from "react";
import { fieldLabel, linkButton } from "./ui";

interface Section {
  title: string;
  /** `View` keys this section is the active one for. */
  views: string[];
  rows: [keys: string, what: string][];
}

const SECTIONS: Section[] = [
  {
    title: "všude",
    views: [],
    rows: [
      ["g h · g k · g t", "HPP · Kontrakty · Triáž"],
      ["g p · g a · g m", "Pipeline · Agentury · Trh"],
      ["g f · g s", "Profil · Aspirace"],
      ["?", "tato nápověda"],
      ["esc", "zavřít · opustit pole"],
    ],
  },
  {
    title: "HPP · Kontrakty",
    views: ["hpp", "kontrakty"],
    rows: [
      ["j · k", "další · předchozí karta (také ↓ ↑)"],
      ["1 · 2 · 3", "hodí se · nehodí se · aspirace"],
      ["r · h", "odpověděl · skrýt"],
      ["d", "návrh odpovědi"],
      ["o", "otevřít inzerát"],
      ["/", "hledat"],
      ["esc", "zrušit výběr"],
    ],
  },
  {
    title: "Triáž",
    views: ["triage"],
    rows: [
      ["1 · 2 · 3 · h", "hodí se · nehodí se · aspirace · skrýt"],
      ["q w e r t y u", "důvod: seniorita · lokalita · stack · forma · obor · plat · firma"],
      ["d", "návrh odpovědi"],
      ["s · →", "přeskočit"],
      ["o", "otevřít inzerát"],
      ["z", "vrátit poslední verdikt"],
    ],
  },
];

/**
 * Modal list of every shortcut. While open it swallows all other keys (capture phase, before any view listener),
 * so a stray `1` cannot label an offer behind the overlay.
 */
export function HelpOverlay({ view, onClose }: { view: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape" || event.key === "?") onClose();
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-bg/85 px-4 py-[calc(1rem+env(safe-area-inset-top))]"
      role="dialog"
      aria-modal="true"
      aria-label="Klávesové zkratky"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-[72ch] overflow-y-auto border border-line-strong bg-surface px-4 py-3 sm:px-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className={fieldLabel}>klávesové zkratky</h2>
          <button type="button" className={linkButton} onClick={onClose}>
            [esc]
          </button>
        </div>
        <div className="grid gap-4">
          {SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className={`${fieldLabel} ${section.views.includes(view) ? "text-signal" : ""}`}>
                {section.title}
                {section.views.includes(view) ? " · tato obrazovka" : ""}
              </h3>
              <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-[2ch] gap-y-0.5 text-sm">
                {section.rows.map(([keys, what]) => (
                  <div key={keys} className="contents">
                    <dt className="font-medium text-fg">{keys}</dt>
                    <dd className="text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
