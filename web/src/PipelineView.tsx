import { useEffect, useState } from "react";
import { fetchApplications, removeApplication, saveApplication } from "./api";
import { formatDate, toDateInput } from "./format";
import { control, fieldLabel, linkButton, note, selectControl, selectWrap, tag } from "./ui";
import type { Application, AppStage } from "./types";
import { STAGE_LABELS, STAGE_ORDER } from "./types";

const external = { target: "_blank", rel: "noreferrer noopener" } as const;

/** Past local midnight: needs a follow-up. */
function isOverdue(iso: string | null, now: Date = new Date()): boolean {
  if (iso === null) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

/** Follow-ups only count for stages awaiting a reply (same rule as the digest). */
export function needsFollowUp(application: Application, now: Date = new Date()): boolean {
  return (application.stage === "applied" || application.stage === "interview") && isOverdue(application.nextActionAt, now);
}

function isToday(iso: string | null): boolean {
  if (iso === null) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() === today.getTime();
}

const nextActionClass = (application: Application): string => {
  if (needsFollowUp(application)) return "text-bad";
  if (isToday(application.nextActionAt)) return "text-signal";
  return "text-faint";
};

const nextActionText = (application: Application): string => {
  const iso = application.nextActionAt;
  if (iso === null) return "bez termínu";
  if (needsFollowUp(application)) return `po termínu ${formatDate(iso)}`;
  if (isToday(iso)) return "dnes";
  return formatDate(iso);
};

interface StageSelectProps {
  value: AppStage | null;
  pending: boolean;
  itemLabel: string;
  onChange: (stage: AppStage | null) => void;
}

/** Compact stage control shared by offer cards and the pipeline view; "—" clears. */
export function StageSelect({ value, pending, itemLabel, onChange }: StageSelectProps) {
  return (
    <span className={selectWrap}>
      <select
        className={`${control} ${selectControl} h-7 text-xs tracking-[0.08em] uppercase`}
        value={value ?? ""}
        disabled={pending}
        aria-label={`Fáze přihlášky: ${itemLabel}`}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === "" ? null : (next as AppStage));
        }}
      >
        <option value="">—</option>
        {STAGE_ORDER.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>
    </span>
  );
}

interface PipelineCardProps {
  application: Application;
  pending: boolean;
  onStage: (application: Application, stage: AppStage | null) => void;
  onNotes: (application: Application, notes: string | null) => void;
  onNextAction: (application: Application, nextActionAt: string | null) => void;
  onRemove: (application: Application) => void;
}

function PipelineCard({ application, pending, onStage, onNotes, onNextAction, onRemove }: PipelineCardProps) {
  const [notes, setNotes] = useState(application.notes ?? "");

  useEffect(() => {
    setNotes(application.notes ?? "");
  }, [application.offerId, application.notes]);


  const commitNotes = () => {
    if (notes === (application.notes ?? "")) return;
    onNotes(application, notes.length > 0 ? notes : null);
  };

  return (
    <article className="grid gap-2 border border-line bg-surface px-3 py-3" aria-label={`Přihláška: ${application.title}`}>
      <h3 className="text-[1rem] leading-snug font-semibold text-balance">
        <a href={application.url} {...external}>
          {application.title}
        </a>
      </h3>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
        {application.company !== null && <span className="font-medium text-fg">{application.company}</span>}
        <span className={`${tag} text-faint`}>{application.source}</span>
        {application.score !== null && <span className="tabular-nums">skóre {application.score}</span>}
        {application.appliedAt !== null && <span title={application.appliedAt}>odesláno {formatDate(application.appliedAt)}</span>}
      </p>
      <p className={`text-sm tabular-nums ${nextActionClass(application)}`}>
        <span className={`${tag} mr-[1ch]`}>další krok</span>
        {nextActionText(application)}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StageSelect
          value={application.stage}
          pending={pending}
          itemLabel={application.title}
          onChange={(stage) => onStage(application, stage)}
        />
        {application.stage === "applied" && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className={fieldLabel}>kdy se ozvat</span>
            <input
              type="date"
              className={`${control} h-7 text-xs`}
              value={toDateInput(application.nextActionAt)}
              disabled={pending}
              aria-label={`Další krok pro ${application.title}`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onNextAction(application, value === "" ? null : value);
              }}
            />
          </label>
        )}
        <button
          type="button"
          className={linkButton}
          disabled={pending}
          title="Odebrat přihlášku z pipeline"
          onClick={() => onRemove(application)}
        >
          [odebrat]
        </button>
      </div>
      <label className="grid gap-1">
        <span className={fieldLabel}>poznámky</span>
        <textarea
          className={`${control} field-sizing-content h-auto min-h-8 resize-y py-1.5 text-sm placeholder:text-faint placeholder:italic`}
          value={notes}
          disabled={pending}
          aria-label={`Poznámky k ${application.title}`}
          placeholder="kdo odpověděl, co slíbil…"
          onChange={(event) => setNotes(event.target.value)}
          onBlur={commitNotes}
        />
      </label>
    </article>
  );
}

export function PipelineView({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchApplications(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRows(data ?? []);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : "Pipeline se nepodařilo načíst";
          setRows([]);
          onError(message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onError]);

  const mutate = async (
    application: Application,
    patch: { stage?: AppStage; nextActionAt?: string | null; notes?: string | null },
  ) => {
    setPendingId(application.offerId);
    try {
      // Only changed keys go on the wire: an absent nextActionAt lets the backend default the first-`applied` follow-up.
      const body: { stage: AppStage; nextActionAt?: string | null; notes?: string | null } = { stage: patch.stage ?? application.stage };
      if (patch.nextActionAt !== undefined) body.nextActionAt = patch.nextActionAt;
      if (patch.notes !== undefined) body.notes = patch.notes;
      const updated = await saveApplication(application.offerId, body);
      setRows((current) => current?.map((row) => (row.offerId === updated.offerId ? updated : row)) ?? null);
    } catch (cause) {
      onError(`Uložení přihlášky selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPendingId(null);
    }
  };

  const setStage = async (application: Application, stage: AppStage | null) => {
    if (stage === null) {
      await remove(application);
      return;
    }
    await mutate(application, { stage });
  };

  const setNotes = async (application: Application, notes: string | null) => {
    await mutate(application, { notes });
  };

  const setNextAction = async (application: Application, nextActionAt: string | null) => {
    await mutate(application, { nextActionAt });
  };

  const remove = async (application: Application) => {
    setPendingId(application.offerId);
    try {
      await removeApplication(application.offerId);
      setRows((current) => current?.filter((row) => row.offerId !== application.offerId) ?? null);
    } catch (cause) {
      onError(`Odebrání přihlášky selhalo: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPendingId(null);
    }
  };

  if (loading || rows === null) {
    return <p className="py-10 text-muted">načítám pipeline…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="grid max-w-[60ch] gap-2 py-10 text-muted">
        $ pipeline/ <br />
        <span className={note}>(prázdné) Nastav fázi na kartě nabídky — objeví se tady.</span>
      </p>
    );
  }

  const byStage = new Map<AppStage, Application[]>();
  for (const row of rows) {
    const group = byStage.get(row.stage) ?? [];
    group.push(row);
    byStage.set(row.stage, group);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3" aria-label="Pipeline přihlášek">
      {STAGE_ORDER.filter((stage) => (byStage.get(stage)?.length ?? 0) > 0).map((stage) => (
        <section key={stage} className="grid content-start gap-3" aria-label={`Fáze ${STAGE_LABELS[stage]}`}>
          <h2 className={fieldLabel}>
            {STAGE_LABELS[stage]} · {(byStage.get(stage) ?? []).length}
          </h2>
          {(byStage.get(stage) ?? []).map((application) => (
            <PipelineCard
              key={application.offerId}
              application={application}
              pending={pendingId === application.offerId}
              onStage={(row, next) => void setStage(row, next)}
              onNotes={(row, notes) => void setNotes(row, notes)}
              onNextAction={(row, nextActionAt) => void setNextAction(row, nextActionAt)}
              onRemove={(row) => void remove(row)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
