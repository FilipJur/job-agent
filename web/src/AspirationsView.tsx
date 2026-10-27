import { AnimatePresence, motion } from "motion/react";
import { FeedbackButtons, ScoreBar } from "./OffersView";
import { WORKPLACE_LABELS } from "./format";
import { meta, note, tag } from "./ui";
import type { AspirationRow, Verdict } from "./types";

const SOURCE_LABEL: Record<AspirationRow["source"], string> = { ai: "AI", user: "ty" };

function AspirationItem({
  row,
  pending,
  onFeedback,
}: {
  row: AspirationRow;
  pending: boolean;
  onFeedback: (id: number, verdict: Verdict) => void;
}) {
  return (
    <motion.article
      className="group/row relative grid grid-cols-[2ch_1fr] gap-x-[1ch] border-b border-line py-3 pr-1 hover:bg-surface"
      data-aspiration-id={row.id}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.12 } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ layout: { duration: 0.12 } }}
    >
      <div className="grid min-w-0 gap-1 col-start-2">
        <div className="flex flex-wrap items-baseline gap-x-[2ch] gap-y-0.5">
          <ScoreBar score={row.score ?? undefined} />
          <h2 className="min-w-[20ch] flex-1 text-[1.125rem] leading-snug font-semibold text-balance">
            <a className="text-fg no-underline decoration-signal hover:underline" href={row.url} target="_blank" rel="noreferrer noopener">
              {row.title}
            </a>
          </h2>
        </div>

        <p className={meta}>
          {row.company !== null && <span className="font-medium text-fg">{row.company}</span>}
          <span>{row.city ?? "bez města"}</span>
          <span>{WORKPLACE_LABELS[row.workplace]}</span>
          <span className={`${tag} text-signal`}>{SOURCE_LABEL[row.source]}</span>
        </p>

        {row.direction.length > 0 && (
          <p className="max-w-[84ch] text-sm text-fg text-pretty">
            <span className={`${tag} mr-[1ch] text-signal`}>kam směřuje</span>
            {row.direction}
          </p>
        )}
        {row.reason.length > 0 && <p className={`${note} max-w-[84ch] text-fg/90 text-pretty`}>{row.reason}</p>}

        {row.labels.length > 0 && (
          <ul className="flex flex-wrap gap-x-[1.5ch] text-xs tracking-[0.04em] text-faint" aria-label="Štítky">
            {row.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}

        <FeedbackButtons
          active={row.source === "user" ? "aspiration" : undefined}
          pending={pending}
          itemLabel={row.title}
          onFeedback={(verdict) => onFeedback(row.id, verdict)}
        />
      </div>
    </motion.article>
  );
}

export function AspirationsView({
  rows,
  pendingId,
  onFeedback,
}: {
  rows: AspirationRow[];
  pendingId: number | null;
  onFeedback: (id: number, verdict: Verdict) => void;
}) {
  return (
    <>
      <div className="relative border-t border-line @container">
        <AnimatePresence mode="popLayout" initial>
          {rows.map((row) => (
            <AspirationItem key={row.id} row={row} pending={pendingId === row.id} onFeedback={onFeedback} />
          ))}
        </AnimatePresence>
      </div>
      {rows.length === 0 && (
        <p className="grid max-w-[60ch] gap-2 py-10 text-muted">
          $ ls aspirace/ <br /><span className={note}>(prázdné) Zatím žádná nabídka se skóre mimo současný dosah.</span>
        </p>
      )}
    </>
  );
}


