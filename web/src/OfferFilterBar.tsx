import { motion } from "motion/react";
import { useState } from "react";
import type { OfferFilters } from "./api";
import { clientFiltersActive, labelCounts, MIN_SCORES, sourceCounts } from "./filters";
import type { ClientFilters, SortKey } from "./filters";
import { offerRatio } from "./format";
import { control, fieldLabel, linkButton, token } from "./ui";
import type { OfferRow } from "./types";

const SERVER_TOGGLES: { key: keyof OfferFilters; label: string }[] = [
  { key: "onlyNew", label: "Nové (24h)" },
  { key: "remote", label: "Remote" },
  { key: "olomouc", label: "Olomouc" },
  { key: "hidden", label: "Skryté" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Podle skóre" },
  { key: "newest", label: "Nejnovější" },
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
  const activeCount =
    filters.labels.length +
    Object.values(serverFilters).filter(Boolean).length +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.source !== "" ? 1 : 0) +
    (filters.query.trim() !== "" ? 1 : 0);
  const anyActive = clientFiltersActive(filters) || Object.values(serverFilters).some(Boolean);

  const toggleLabel = (label: string) => {
    const next = filters.labels.includes(label)
      ? filters.labels.filter((selected) => selected !== label)
      : [...filters.labels, label];
    onChange({ ...filters, labels: next });
  };

  return (
    <section className="mb-2 border-b border-line pb-3" aria-label="Filtry nabídek">
      <div className="flex items-center justify-between gap-3 sm:hidden">
        <button type="button" className={`${control} font-medium`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Filtry{activeCount > 0 ? ` · ${activeCount}` : ""}
        </button>
        <span className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-muted tabular-nums">{offerRatio(shown, offers.length)}</span>
          {anyActive && (
            <button type="button" className={`${linkButton} !text-xs`} onClick={onReset}>
              Zrušit
            </button>
          )}
        </span>
      </div>

      <div className={`${open ? "grid" : "hidden"} gap-x-4 gap-y-2.5 pt-3 sm:grid sm:pt-0 sm:grid-cols-[4.5rem_1fr] sm:items-center`}>
        <span className={`${fieldLabel} hidden sm:block`}>Hledat</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={`${control} min-w-48 flex-1 placeholder:text-faint`}
            placeholder="název, firma, důvod…  ( / )"
            aria-label="Hledat v nabídkách"
            data-search
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.currentTarget.value })}
          />
          <select
            className={control}
            aria-label="Zdroj"
            value={filters.source}
            onChange={(event) => onChange({ ...filters, source: event.currentTarget.value })}
          >
            <option value="">Všechny zdroje</option>
            {sources.map(({ source, count }) => (
              <option key={source} value={source}>
                {source} ({count})
              </option>
            ))}
          </select>
          <select
            className={control}
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
        </div>

        <span className={`${fieldLabel} hidden sm:block`}>Skóre od</span>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Minimální skóre">
          {MIN_SCORES.map((min) => (
            <button
              key={min}
              type="button"
              className={`${token} relative font-mono tabular-nums`}
              aria-pressed={filters.minScore === min}
              onClick={() => onChange({ ...filters, minScore: min })}
            >
              {min === 0 ? "vše" : `${min}+`}
            </button>
          ))}
        </div>

        <span className={`${fieldLabel} hidden sm:block`}>Zobrazit</span>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rychlé filtry">
          {SERVER_TOGGLES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={token}
              aria-pressed={serverFilters[key]}
              onClick={() => onServerToggle(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {labels.length > 0 && (
          <>
            <span className={`${fieldLabel} hidden self-start pt-1 sm:block`}>Štítky</span>
            <ul className="flex flex-wrap gap-x-0.5 gap-y-1" aria-label="Štítky (všechny vybrané musí platit)">
              {labels.map(({ label, count, selected }) => (
                <li key={label}>
                  <motion.button
                    type="button"
                    className={`${token} inline-flex items-baseline gap-1.5 font-mono !text-[0.8125rem] ${count === 0 && !selected ? "opacity-35" : ""}`}
                    aria-pressed={selected}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => toggleLabel(label)}
                  >
                    {label}
                    <span className={selected ? "text-bg/60 tabular-nums" : "text-faint tabular-nums"}>{count}</span>
                  </motion.button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="mt-3 hidden items-center gap-3 text-sm text-muted sm:flex" aria-live="polite">
        <span className="font-mono tabular-nums">{offerRatio(shown, offers.length)}</span>
        {anyActive && (
          <button type="button" className={linkButton} onClick={onReset}>
            Zrušit filtry
          </button>
        )}
      </p>
    </section>
  );
}
