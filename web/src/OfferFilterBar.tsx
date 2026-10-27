import { motion } from "motion/react";
import type { OfferFilters } from "./api";
import { clientFiltersActive, labelCounts, MIN_SCORES, sourceCounts } from "./filters";
import type { ClientFilters, SortKey } from "./filters";
import { offerRatio } from "./format";
import { control, linkButton, pill } from "./ui";
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
  const labels = labelCounts(offers, filters);
  const sources = sourceCounts(offers);
  const anyActive = clientFiltersActive(filters) || Object.values(serverFilters).some(Boolean);

  const toggleLabel = (label: string) => {
    const next = filters.labels.includes(label)
      ? filters.labels.filter((selected) => selected !== label)
      : [...filters.labels, label];
    onChange({ ...filters, labels: next });
  };

  return (
    <section
      className="mb-5 grid gap-3 rounded-xl border border-line bg-surface/70 p-3 backdrop-blur-sm sm:p-4"
      aria-label="Filtry nabídek"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={`${control} min-w-48 flex-1 placeholder:text-muted/70`}
          placeholder="Hledat v názvu, firmě, důvodu…"
          aria-label="Hledat v nabídkách"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.currentTarget.value })}
        />
        <div
          className="inline-flex h-9 items-center rounded-lg border border-line bg-raised p-0.5"
          role="group"
          aria-label="Minimální skóre"
        >
          <span className="px-2 text-[0.65rem] tracking-widest text-muted uppercase">Skóre</span>
          {MIN_SCORES.map((min) => (
            <button
              key={min}
              type="button"
              className="relative h-full min-w-9 rounded-md px-2 font-mono text-xs text-muted transition-colors hover:text-fg aria-pressed:text-bg"
              aria-pressed={filters.minScore === min}
              onClick={() => onChange({ ...filters, minScore: min })}
            >
              {filters.minScore === min && (
                <motion.span
                  layoutId="seg-pill"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ type: "spring", duration: 0.3, bounce: 0.15 }}
                />
              )}
              <span className="relative">{min === 0 ? "vše" : `${min}+`}</span>
            </button>
          ))}
        </div>
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

      <div className="flex flex-wrap gap-2" role="group" aria-label="Rychlé filtry">
        {SERVER_TOGGLES.map(({ key, label }) => (
          <motion.button
            key={key}
            type="button"
            className={pill}
            aria-pressed={serverFilters[key]}
            whileTap={{ scale: 0.95 }}
            onClick={() => onServerToggle(key)}
          >
            {label}
          </motion.button>
        ))}
      </div>

      {labels.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Štítky (všechny vybrané musí platit)">
          {labels.map(({ label, count, selected }) => (
            <li key={label}>
              <motion.button
                type="button"
                className={`${pill} inline-flex items-center gap-1.5 !px-2.5 font-mono !text-xs ${count === 0 && !selected ? "opacity-40" : ""}`}
                aria-pressed={selected}
                whileTap={{ scale: 0.94 }}
                onClick={() => toggleLabel(label)}
              >
                {label}
                <span className="text-muted tabular-nums">{count}</span>
              </motion.button>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-3 text-sm text-muted" aria-live="polite">
        <span className="font-mono">{offerRatio(shown, offers.length)}</span>
        {anyActive && (
          <button type="button" className={linkButton} onClick={onReset}>
            Zrušit filtry
          </button>
        )}
      </p>
    </section>
  );
}
