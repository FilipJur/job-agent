import type { AgencyStatus, OfferRow, Workplace } from "./types";

const numberFormat = new Intl.NumberFormat("cs-CZ");
const dateFormat = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" });

export const WORKPLACE_LABELS: Record<Workplace, string> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "na místě",
  unknown: "místo neuvedeno",
};

export const STATUS_LABELS: Record<AgencyStatus, string> = {
  new: "neosloveno",
  contacted: "osloveno",
  replied: "odpověď",
  meeting: "schůzka",
  work: "zakázka",
  declined: "odmítnuto",
};

export const STATUSES: AgencyStatus[] = ["new", "contacted", "replied", "meeting", "work", "declined"];

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormat.format(date);
}

/** ISO string → `YYYY-MM-DD` for `<input type="date">`. */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function formatSalary(offer: OfferRow): string | null {
  const { salaryMin, salaryMax, currency } = offer;
  const unit = currency ?? "";
  const suffix = unit ? ` ${unit}` : "";
  if (salaryMin !== null && salaryMax !== null) {
    return `${numberFormat.format(salaryMin)}–${numberFormat.format(salaryMax)}${suffix}`;
  }
  if (salaryMin !== null) return `od ${numberFormat.format(salaryMin)}${suffix}`;
  if (salaryMax !== null) return `do ${numberFormat.format(salaryMax)}${suffix}`;
  return null;
}

/** Agency `web` values are stored without a scheme in the seed data. */
export function withHttps(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function offerCount(count: number): string {
  if (count === 1) return "1 nabídka";
  if (count >= 2 && count <= 4) return `${count} nabídky`;
  return `${count} nabídek`;
}

export function agencyCount(count: number): string {
  if (count === 1) return "1 agentura";
  if (count >= 2 && count <= 4) return `${count} agentury`;
  return `${count} agentur`;
}
