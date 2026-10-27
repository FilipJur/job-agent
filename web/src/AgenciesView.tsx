import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { crawlStatus, STATUS_LABELS, STATUSES, toDateInput, withHttps } from "./format";
import { control, fieldLabel, linkButton, primaryButton } from "./ui";
import type { AgencyPatch, AgencyRow, AgencyStatus } from "./types";

interface AgencyItemProps {
  agency: AgencyRow;
  index: number;
  saving: boolean;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

const external = { target: "_blank", rel: "noreferrer noopener" } as const;

function AgencyItem({ agency, index, saving, onSave }: AgencyItemProps) {
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
      className={`relative grid gap-x-8 gap-y-3 rounded-md border border-line bg-surface p-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_17rem] @3xl:rounded-none @3xl:border-0 @3xl:border-b @3xl:bg-transparent @3xl:px-3 @3xl:py-5 ${
        agency.hiringIco ? "before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:bg-signal @max-3xl:before:inset-y-3 @max-3xl:before:left-px" : ""
      }`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 8) * 0.025 }}
    >
      <div className="grid content-start gap-1">
        <h3 className="flex items-baseline gap-2 text-base leading-snug font-semibold text-balance">
          {agency.web !== null ? (
            <a className="no-underline decoration-signal hover:underline" href={withHttps(agency.web)} {...external}>
              {agency.name}
            </a>
          ) : (
            agency.name
          )}
          <span className="font-mono text-xs font-normal text-faint" title="Shoda s profilem">
            fit {agency.fit}
          </span>
        </h3>
        {(agency.city !== null || agency.focus !== null) && (
          <p className="text-sm text-muted text-pretty">
            {agency.city !== null && <span className="font-medium text-fg">{agency.city}</span>}
            {agency.city !== null && agency.focus !== null && " · "}
            {agency.focus}
          </p>
        )}
        {agency.stack !== null && <p className="font-mono text-xs text-faint text-pretty">{agency.stack}</p>}
      </div>

      <div className="grid content-start gap-2">
        {(agency.hiringIco || agency.hourlyRate !== null) && (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            {agency.hiringIco && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-signal">
                <span className="size-1.5 bg-signal" aria-hidden="true" />
                hledají na IČO
              </span>
            )}
            {agency.hourlyRate !== null && <span className="font-mono text-ok">{agency.hourlyRate}</span>}
          </p>
        )}
        {agency.hiringEvidence !== null && (
          <blockquote className="border-l border-line-strong pl-3 text-sm text-fg/85 text-pretty">
            „{agency.hiringEvidence}“
            {agency.careersUrl !== null && (
              <>
                {" "}
                <a className="font-mono text-xs whitespace-nowrap" href={withHttps(agency.careersUrl)} {...external}>
                  zdroj ↗
                </a>
              </>
            )}
          </blockquote>
        )}
        {agency.hiringEvidence === null && agency.careersUrl !== null && (
          <a className={`${linkButton} justify-self-start`} href={withHttps(agency.careersUrl)} {...external}>
            Kariérní stránka ↗
          </a>
        )}
        <p className="font-mono text-xs text-faint" title={agency.crawledAt ?? undefined}>
          {crawlStatus(agency.crawledAt)}
        </p>
      </div>

      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
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
            <span className={fieldLabel}>Stav</span>
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
            <span className={fieldLabel}>Poslední kontakt</span>
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
        </div>
      </div>

      <label className="grid gap-1 @3xl:col-span-3">
        <span className={fieldLabel}>Poznámky</span>
        <textarea
          className={`${control} field-sizing-content h-auto min-h-8 resize-y py-1.5 placeholder:text-faint`}
          value={notes}
          disabled={saving}
          aria-label={`Poznámky pro ${agency.name}`}
          placeholder="Kdo odpověděl, co slíbil, kdy se ozvat…"
          onChange={(event) => setNotes(event.currentTarget.value)}
          onBlur={commitNotes}
        />
      </label>
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
    return <p className="py-12 text-muted">Načítám agentury…</p>;
  }
  if (agencies.length === 0) {
    return <p className="max-w-md py-12 text-muted">Seznam agentur je prázdný. Naplní ho <code className="font-mono text-fg">bun run agencies:seed</code>.</p>;
  }
  const hiring = agencies.filter((agency) => agency.hiringIco);
  const others = agencies.filter((agency) => !agency.hiringIco);

  const renderSection = (title: string, rows: AgencyRow[], empty: string) => (
    <section className="mb-10 @container" aria-label={title}>
      <h2 className="mb-3 flex items-baseline gap-2 border-b border-line pb-2 text-sm font-semibold">
        {title}
        <span className="font-mono text-xs font-normal text-faint tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted">{empty}</p>
      ) : (
        <div className="grid gap-3 @3xl:gap-0">
          {rows.map((agency, index) => (
            <AgencyItem key={agency.id} agency={agency} index={index} saving={savingId === agency.id} onSave={onSave} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {renderSection("Shánějí na IČO", hiring, "Zatím nikdo, u koho by crawler našel výslovné hledání na IČO. Zkontroluj, jestli už běžel.")}
      {renderSection("Ostatní agentury", others, "Žádné další agentury.")}
    </>
  );
}
