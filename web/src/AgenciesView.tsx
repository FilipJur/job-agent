import { useEffect, useState } from "react";
import { STATUS_LABELS, STATUSES, toDateInput, withHttps } from "./format";
import type { AgencyPatch, AgencyRow, AgencyStatus } from "./types";

interface AgencyRowProps {
  agency: AgencyRow;
  saving: boolean;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

function AgencyTableRow({ agency, saving, onSave }: AgencyRowProps) {
  const [notes, setNotes] = useState(agency.notes ?? "");

  useEffect(() => {
    setNotes(agency.notes ?? "");
  }, [agency.id, agency.notes]);

  const commitNotes = () => {
    if (notes === (agency.notes ?? "")) return;
    onSave(agency, { notes: notes.length > 0 ? notes : null });
  };

  return (
    <tr>
      <td data-label="Agentura" className="agency-name">
        {agency.web !== null ? (
          <a href={withHttps(agency.web)} target="_blank" rel="noreferrer noopener">
            {agency.name}
          </a>
        ) : (
          agency.name
        )}
        {(agency.email !== null || agency.phone !== null) && (
          <span className="contact">
            {agency.email !== null && <a href={`mailto:${agency.email}`}>{agency.email}</a>}
            {agency.phone !== null && <a href={`tel:${agency.phone.replace(/\s+/g, "")}`}>{agency.phone}</a>}
          </span>
        )}
      </td>
      <td data-label="Město">{agency.city ?? "—"}</td>
      <td data-label="Zaměření">{agency.focus ?? "—"}</td>
      <td data-label="Stack">{agency.stack ?? "—"}</td>
      <td data-label="Fit">
        <span className="fit">{agency.fit}</span>
      </td>
      <td data-label="Stav">
        <select
          className="status-select"
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
      </td>
      <td data-label="Poznámky" className="notes-cell">
        <textarea
          className="notes"
          rows={2}
          value={notes}
          disabled={saving}
          aria-label={`Poznámky pro ${agency.name}`}
          placeholder="Poznámky…"
          onChange={(event) => setNotes(event.currentTarget.value)}
          onBlur={commitNotes}
        />
      </td>
      <td data-label="Poslední kontakt">
        <input
          type="date"
          className="date-input"
          value={toDateInput(agency.lastContactAt)}
          disabled={saving}
          aria-label={`Poslední kontakt s ${agency.name}`}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onSave(agency, { lastContactAt: value === "" ? null : value });
          }}
        />
      </td>
    </tr>
  );
}

interface AgenciesViewProps {
  agencies: AgencyRow[] | null;
  savingId: number | null;
  onSave: (agency: AgencyRow, patch: AgencyPatch) => void;
}

export function AgenciesView({ agencies, savingId, onSave }: AgenciesViewProps) {
  if (agencies === null) {
    return <p className="empty">Načítám agentury…</p>;
  }
  if (agencies.length === 0) {
    return (
      <div className="empty">
        <p>Žádné agentury.</p>
      </div>
    );
  }
  return (
    <table className="agencies">
      <thead>
        <tr>
          <th scope="col">Agentura</th>
          <th scope="col">Město</th>
          <th scope="col">Zaměření</th>
          <th scope="col">Stack</th>
          <th scope="col">Fit</th>
          <th scope="col">Stav</th>
          <th scope="col">Poznámky</th>
          <th scope="col">Poslední kontakt</th>
        </tr>
      </thead>
      <tbody>
        {agencies.map((agency) => (
          <AgencyTableRow
            key={agency.id}
            agency={agency}
            saving={savingId === agency.id}
            onSave={onSave}
          />
        ))}
      </tbody>
    </table>
  );
}
