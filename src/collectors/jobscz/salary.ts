import { decodeEntities } from "./html";

const NONE = { min: null, max: null, currency: null } as const;

/** Non-monthly units: hourly/yearly/daily/weekly amounts are not comparable, so they are dropped. */
const NON_MONTHLY = /\/\s*(hod|rok|roč|den|týd|year|hour|day|week)/i;

/** Monthly salary from a jobs.cz salary text. Handles NBSP/ZWJ separators, decoded or raw entities. */
export function parseSalaryText(text: string): { min: number | null; max: number | null; currency: string | null } {
  const t = decodeEntities(text)
    .replace(/[\u200b\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (NON_MONTHLY.test(t)) return { ...NONE };

  const currency = /Kč|CZK/i.test(t) ? "CZK" : /€|EUR/i.test(t) ? "EUR" : null;
  if (!currency) return { ...NONE };

  // Thousands are space-separated groups ("120 000"); a plain run of digits is one number.
  const values = [...t.matchAll(/\d{1,3}(?: \d{3})+|\d+/g)].map((m) => Number(m[0].replaceAll(" ", "")));
  const first = values[0];
  if (first === undefined) return { ...NONE };
  const second = values[1];
  if (second === undefined) return { min: first, max: first, currency };
  return { min: Math.min(first, second), max: Math.max(first, second), currency };
}
