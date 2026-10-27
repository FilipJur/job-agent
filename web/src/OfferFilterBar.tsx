import { useState } from "react";
import type { OfferFilters } from "./api";
import { activeFilterCount, labelCounts, MIN_SCORES, sourceCounts } from "./filters";
import type { ClientFilters, SortKey } from "./filters";
import { offerRatio } from "./format";
import { checkbox, control, fieldLabel, linkButton, radio, selectControl, selectWrap } from "./ui";
import type { OfferRow } from "./types";

const SERVER_TOGGLES: { key: keyof OfferFilters; label: string }[] = [
  { key: "onlyNew", label: "nové (24h)" },
  { key: "remote", label: "remote" },
  { key: "olomouc", label: "olomouc" },
  { key: "hidden", label: "skryté" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "podle skóre" },
  { key: "newest", label: "nejnovější" },
];

interface OfferFilterBarProps {
  /** Everything loaded for the tab, before client-side filtering. */
  offers: OfferRow[];
  shown: number;
  serverFilters: OfferFilters;
  filters: ClientFilters;
  onServerToggle: (key: keyof OfferFilters) => void;
  onChange: (filters: ClientFilters) => void;
  onReset: () => void;
}

export function OfferFilterBar({
  offers,
  shown,
  serverFilters,
  filters,
  onServerToggle,
  onChange,
  onReset,
}: OfferFilterBarProps) {
  const [open, setOpen] = useState(false);
  const labels = labelCounts(offers, filters);
  const sources = sourceCounts(offers);
  const activeCount = activeFilterCount(filters, serverFilters);

  const toggleLabel = (label: string) => {
    const next = filters.labels.includes(label)
      ? filters.labels.filter((selected) => selected !== label)
      : [...filters.labels, label];
    onChange({ ...filters, labels: next });
  };

  return (
    <fieldset className="mb-5 border border-line px-3 pt-0 pb-3 sm:px-4" aria-label="Filtry nabídek">
      <legend className="text-xs text-faint">filtry{activeCount > 0 ? ` · ${activeCount}` : ""}</legend>

      <div className="flex items-center justify-between gap-3 sm:hidden">
        <button type="button" className={`${control} text-sm`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "[-] skrýt filtry" : "[+] zobrazit filtry"}
        </button>
        <span className="text-xs text-muted tabular-nums">{offerRatio(shown, offers.length)}</span>
      </div>

      <div className={`${open ? "grid" : "hidden"} gap-x-4 gap-y-2 pt-3 sm:grid sm:grid-cols-[7ch_1fr] sm:items-center sm:pt-2`}>
        <span className={`${fieldLabel} hidden sm:block`}>hledat</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${control} flex min-w-48 flex-1 items-center gap-2 focus-within:border-signal`}>
            <span className="text-signal" aria-hidden="true">
              &gt;
            </span>
            <input
              type="search"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              placeholder="název, firma, důvod   ( / )"
              aria-label="Hledat v nabídkách"
              data-search
              value={filters.query}
              onChange={(event) => onChange({ ...filters, query: event.currentTarget.value })}
            />
          </label>
          <span className={selectWrap}>
            <select
              className={`${control} ${selectControl}`}
              aria-label="Zdroj"
              value={filters.source}
              onChange={(event) => onChange({ ...filters, source: event.currentTarget.value })}
            >
              <option value="">všechny zdroje</option>
              {sources.map(({ source, count }) => (
                <option key={source} value={source}>
                  {source} ({count})
                </option>
              ))}
            </select>
          </span>
          <span className={selectWrap}>
            <select
              className={`${control} ${selectControl}`}
              aria-label="Řazení"
              value={filters.sort}
              onChange={(event) => onChange({ ...filters, sort: event.currentTarget.value as SortKey })}
            >
              {SORTS.map((sort) => (
                <option key={sort.key} value={sort.key}>
                  {sort.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        <span className={`${fieldLabel} hidden sm:block`}>skóre od</span>
        <div className="flex flex-wrap items-center gap-x-4" role="group" aria-label="Minimální skóre">
          {MIN_SCORES.map((min) => (
            <button
              key={min}
              type="button"
              className={`${radio} rb tabular-nums`}
              aria-pressed={filters.minScore === min}
              onClick={() => onChange({ ...filters, minScore: min })}
            >
              {min === 0 ? "vše" : `${min}+`}
            </button>
          ))}
        </div>

        <span className={`${fieldLabel} hidden sm:block`}>zobrazit</span>
        <div className="flex flex-wrap items-center gap-x-4" role="group" aria-label="Rychlé filtry">
          {SERVER_TOGGLES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`${checkbox} cb`}
              aria-pressed={serverFilters[key]}
              onClick={() => onServerToggle(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {labels.length > 0 && (
          <>
            <span className={`${fieldLabel} hidden self-start sm:block`}>štítky</span>
            <ul className="flex flex-wrap gap-x-4" aria-label="Štítky (všechny vybrané musí platit)">
              {labels.map(({ label, count, selected }) => (
                <li key={label}>
                  <button
                    type="button"
                    className={`${checkbox} cb ${count === 0 && !selected ? "opacity-35" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleLabel(label)}
                  >
                    {label} <span className="text-faint tabular-nums">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="mt-3 flex items-center gap-4 text-sm text-muted" aria-live="polite">
        <span className="hidden tabular-nums sm:inline">{offerRatio(shown, offers.length)}</span>
        {activeCount > 0 && (
          <button type="button" className={linkButton} onClick={onReset}>
            zrušit filtry
          </button>
        )}
      </p>
    </fieldset>
  );
}
