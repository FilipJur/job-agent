import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { crawlStatus, STATUS_LABELS, STATUSES, toDateInput, withHttps } from "./format";
import { control, fieldLabel, linkButton, note, primaryButton, RULE, selectControl, selectWrap, tag } from "./ui";
import type { AgencyPatch, AgencyRow, AgencyStatus } from "./types";

interface AgencyItemProps {
  agency: AgencyRow;
  saving: boolean;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

const external = { target: "_blank", rel: "noreferrer noopener" } as const;

const FORM_LABELS = { ico: "IČO", hpp: "HPP", both: "IČO i HPP", unknown: "forma neuvedena" } as const;

function AgencyItem({ agency, saving, onSave }: AgencyItemProps) {
  const [notes, setNotes] = useState(agency.notes ?? "");

  useEffect(() => {
    setNotes(agency.notes ?? "");
  }, [agency.id, agency.notes]);

  const commitNotes = () => {
    if (notes === (agency.notes ?? "")) return;
    onSave(agency, { notes: notes.length > 0 ? notes : null });
  };

  return (
    <motion.fieldset
      className={`grid gap-x-8 gap-y-3 border px-3 pt-1 pb-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem] sm:px-4 ${
        agency.devPositionOpen ? "border-signal/60" : "border-line"
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
    >
      <legend className="max-w-full text-[1.125rem] font-semibold">
        {agency.web !== null ? (
          <a className="no-underline hover:underline" href={withHttps(agency.web)} {...external}>
            {agency.name}
          </a>
        ) : (
          agency.name
        )}
        <span className={`${tag} ml-3 font-normal text-faint`} title="Shoda s profilem">
          fit {agency.fit}
        </span>
        {agency.aiFit !== null && (
          <span className="ml-2 font-normal text-faint tabular-nums" title={agency.aiReason ?? undefined}>
            AI {agency.aiFit}
          </span>
        )}
      </legend>

      <div className="grid content-start gap-1">
        {(agency.city !== null || agency.focus !== null) && (
          <p className="text-sm text-muted text-pretty">
            {agency.city !== null && <span className="font-medium text-fg">{agency.city}</span>}
            {agency.city !== null && agency.focus !== null && " │ "}
            {agency.focus}
          </p>
        )}
        {agency.stack !== null && <p className="text-xs tracking-[0.04em] text-faint text-pretty">{agency.stack}</p>}
      </div>

      <div className="grid content-start gap-2">
        {agency.devPositionOpen && agency.positionTitle !== null && (
          <p className="text-sm font-medium text-pretty">
            {agency.positionUrl !== null ? (
              <a className="underline decoration-signal underline-offset-2" href={withHttps(agency.positionUrl)} {...external}>
                {agency.positionTitle} ↗
              </a>
            ) : (
              agency.positionTitle
            )}
          </p>
        )}
        {(agency.form !== null || agency.devRate !== null) && (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            {agency.form !== null && <span className={`${tag} bg-signal px-1.5 !font-semibold text-bg`}>{FORM_LABELS[agency.form]}</span>}
            {agency.devRate !== null && <span className="text-ok">{agency.devRate}</span>}
            {agency.remoteOrOlomouc && <span className="text-muted">remote / Olomouc</span>}
          </p>
        )}
        {agency.evidenceQuote !== null && (
          <blockquote className={`${note} text-sm text-fg/85 text-pretty before:mr-[1ch] before:text-signal before:not-italic before:content-['>']`}>
            {agency.evidenceQuote}
          </blockquote>
        )}
        {agency.aiReason !== null && <p className="text-sm text-muted text-pretty">{agency.aiReason}</p>}
        {agency.positionUrl !== null && agency.evidenceQuote === null && (
          <a className={`${linkButton} justify-self-start`} href={withHttps(agency.positionUrl)} {...external}>
            otevřená pozice ↗
          </a>
        )}
        <p className={`${tag} text-faint`} title={agency.crawledAt ?? undefined}>
          {crawlStatus(agency.crawledAt)}
        </p>
      </div>

      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          {agency.contactUrl !== null && (
            <a className={primaryButton} href={withHttps(agency.contactUrl)} {...external}>
              kontaktní formulář ↗
            </a>
          )}
          {agency.contactUrl === null && agency.email !== null && (
            <a className={primaryButton} href={`mailto:${agency.email}`}>
              napsat e-mail
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
            <span className={fieldLabel}>stav</span>
            <span className={`${selectWrap} w-full`}>
              <select
                className={`${control} ${selectControl} w-full`}
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
            </span>
          </label>
          <label className="grid gap-1">
            <span className={fieldLabel}>poslední kontakt</span>
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
        <span className={fieldLabel}>poznámky</span>
        <textarea
          className={`${control} field-sizing-content h-auto min-h-8 resize-y py-1.5 placeholder:text-faint placeholder:italic`}
          value={notes}
          disabled={saving}
          aria-label={`Poznámky pro ${agency.name}`}
          placeholder="kdo odpověděl, co slíbil, kdy se ozvat…"
          onChange={(event) => setNotes(event.currentTarget.value)}
          onBlur={commitNotes}
        />
      </label>
    </motion.fieldset>
  );
}

interface AgenciesViewProps {
  agencies: AgencyRow[] | null;
  savingId: number | null;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

export function AgenciesView({ agencies, savingId, onSave }: AgenciesViewProps) {
  if (agencies === null) {
    return <p className="py-10 text-muted">načítám agentury…</p>;
  }
  if (agencies.length === 0) {
    return (
      <p className="max-w-[60ch] py-10 text-muted">
        $ ls agentury/ <br />
        <span className={note}>(prázdné) Naplní to <code className="not-italic text-fg">bun run agencies:seed</code>.</span>
      </p>
    );
  }
  const open = agencies.filter((agency) => agency.devPositionOpen);
  const others = agencies.filter((agency) => !agency.devPositionOpen);

  const renderSection = (title: string, rows: AgencyRow[], empty: string) => (
    <section className="mb-8 @container" aria-label={title}>
      <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase" aria-label={`${title} (${rows.length})`}>
        <span aria-hidden="true" className="text-line-strong">
          ──
        </span>
        <span>
          {title} <span className="font-normal tracking-normal text-faint tabular-nums">({rows.length})</span>
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1 overflow-hidden text-line-strong select-none">
          {RULE}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className={`${note} text-sm text-muted`}>{empty}</p>
      ) : (
        <div className="grid gap-5">
          {rows.map((agency) => (
            <AgencyItem key={agency.id} agency={agency} saving={savingId === agency.id} onSave={onSave} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {renderSection("Hledají web dev teď", open, "zatím nikdo, u koho by crawler našel otevřenou web-dev pozici. Zkontroluj, jestli už běžel.")}
      {renderSection("Bez otevřené pozice", others, "žádné další agentury.")}
    </>
  );
}
