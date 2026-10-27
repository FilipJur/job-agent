import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { crawlStatus, STATUS_LABELS, STATUSES, toDateInput, withHttps } from "./format";
import { control, linkButton, primaryButton } from "./ui";
import type { AgencyPatch, AgencyRow, AgencyStatus } from "./types";

interface AgencyCardProps {
  agency: AgencyRow;
  index: number;
  saving: boolean;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

const external = { target: "_blank", rel: "noreferrer noopener" } as const;

function AgencyCard({ agency, index, saving, onSave }: AgencyCardProps) {
  const [notes, setNotes] = useState(agency.notes ?? "");

  useEffect(() => {
    setNotes(agency.notes ?? "");
  }, [agency.id, agency.notes]);

  const commitNotes = () => {
    if (notes === (agency.notes ?? "")) return;
    onSave(agency, { notes: notes.length > 0 ? notes : null });
  };

  return (
    <motion.article
      className={`grid content-start gap-3 rounded-xl border p-4 ${
        agency.hiringIco ? "border-accent/45 bg-linear-to-br from-accent/10 to-surface" : "border-line bg-surface"
      }`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 8) * 0.03 }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg leading-snug font-medium text-balance">
          {agency.web !== null ? (
            <a className="text-fg no-underline hover:text-accent hover:underline" href={withHttps(agency.web)} {...external}>
              {agency.name}
            </a>
          ) : (
            agency.name
          )}
        </h3>
        <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted" title="Shoda s profilem">
          fit {agency.fit}
        </span>
      </header>

      {(agency.city !== null || agency.focus !== null || agency.stack !== null) && (
        <div className="grid gap-0.5 text-sm text-muted">
          {(agency.city !== null || agency.focus !== null) && (
            <p className="text-pretty">
              {agency.city !== null && <span className="font-medium text-fg/85">{agency.city}</span>}
              {agency.city !== null && agency.focus !== null && " · "}
              {agency.focus}
            </p>
          )}
          {agency.stack !== null && <p className="font-mono text-xs text-pretty">{agency.stack}</p>}
        </div>
      )}

      {(agency.hourlyRate !== null || agency.hiringIco) && (
        <p className="flex flex-wrap gap-2">
          {agency.hiringIco && (
            <span className="rounded bg-accent px-2 py-0.5 text-xs font-semibold text-bg">hledají na IČO</span>
          )}
          {agency.hourlyRate !== null && (
            <span className="rounded border border-good/50 px-2 py-0.5 font-mono text-xs text-good">{agency.hourlyRate}</span>
          )}
        </p>
      )}

      {agency.hiringEvidence !== null && (
        <blockquote className="grid gap-1 border-l-2 border-accent/60 pl-3">
          <p className="font-display text-[0.95rem] text-fg/90 italic text-pretty">„{agency.hiringEvidence}“</p>
          {agency.careersUrl !== null && (
            <a className="justify-self-start font-mono text-xs" href={withHttps(agency.careersUrl)} {...external}>
              zdroj ↗
            </a>
          )}
        </blockquote>
      )}
      {agency.hiringEvidence === null && agency.careersUrl !== null && (
        <a className={`${linkButton} justify-self-start`} href={withHttps(agency.careersUrl)} {...external}>
          Kariérní stránka ↗
        </a>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {agency.contactUrl !== null && (
          <a className={primaryButton} href={withHttps(agency.contactUrl)} {...external}>
            Kontaktní formulář ↗
          </a>
        )}
        {agency.contactUrl === null && agency.email !== null && (
          <a className={primaryButton} href={`mailto:${agency.email}`}>
            Napsat e-mail
          </a>
        )}
        {agency.email !== null && <a href={`mailto:${agency.email}`}>{agency.email}</a>}
        {agency.phone !== null && <a href={`tel:${agency.phone.replace(/\s+/g, "")}`}>{agency.phone}</a>}
        {agency.contactUrl === null && agency.email === null && agency.phone === null && (
          <span className="text-muted">kontakt neznámý</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">
          <span className="text-[0.65rem] tracking-widest text-muted uppercase">Stav</span>
          <select
            className={control}
            value={agency.status}
            disabled={saving}
            aria-label={`Stav agentury ${agency.name}`}
            onChange={(event) => onSave(agency, { status: event.currentTarget.value as AgencyStatus })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[0.65rem] tracking-widest text-muted uppercase">Poslední kontakt</span>
          <input
            type="date"
            className={control}
            value={toDateInput(agency.lastContactAt)}
            disabled={saving}
            aria-label={`Poslední kontakt s ${agency.name}`}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onSave(agency, { lastContactAt: value === "" ? null : value });
            }}
          />
        </label>
        <label className="col-span-2 grid gap-1">
          <span className="text-[0.65rem] tracking-widest text-muted uppercase">Poznámky</span>
          <textarea
            className={`${control} field-sizing-content h-auto min-h-16 resize-y py-2`}
            value={notes}
            disabled={saving}
            aria-label={`Poznámky pro ${agency.name}`}
            placeholder="Poznámky…"
            onChange={(event) => setNotes(event.currentTarget.value)}
            onBlur={commitNotes}
          />
        </label>
      </div>

      <p className="font-mono text-xs text-muted" title={agency.crawledAt ?? undefined}>
        {crawlStatus(agency.crawledAt)}
      </p>
    </motion.article>
  );
}

interface AgenciesViewProps {
  agencies: AgencyRow[] | null;
  savingId: number | null;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

export function AgenciesView({ agencies, savingId, onSave }: AgenciesViewProps) {
  if (agencies === null) {
    return <p className="py-16 text-center text-muted">Načítám agentury…</p>;
  }
  if (agencies.length === 0) {
    return (
      <p className="py-16 text-center text-muted">Žádné agentury.</p>
    );
  }
  const hiring = agencies.filter((agency) => agency.hiringIco);
  const others = agencies.filter((agency) => !agency.hiringIco);

  const renderSection = (title: string, rows: AgencyRow[], empty: string) => (
    <section className="mb-10 @container" aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-medium">
        {title}
        <span className="rounded-full border border-line px-2 font-mono text-xs text-muted">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <div className="grid gap-4 @3xl:grid-cols-2">
          {rows.map((agency, index) => (
            <AgencyCard key={agency.id} agency={agency} index={index} saving={savingId === agency.id} onSave={onSave} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {renderSection("Shánějí na IČO", hiring, "Zatím žádná agentura s doloženým hledáním na IČO.")}
      {renderSection("Ostatní agentury", others, "Žádné další agentury.")}
    </>
  );
}
