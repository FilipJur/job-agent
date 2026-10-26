import { foldDiacritics } from "../../text";
import type { RawOffer } from "../../types";

export const SOURCE = "ashby";

export interface AshbyOrg {
  id: string;
  name: string;
  /** Keep only jobs in these departments (exact match); all jobs when absent. */
  departments?: string[];
}

interface AshbyPostalAddress {
  addressLocality?: string | null;
  addressRegion?: string | null;
  addressCountry?: string | null;
}

interface AshbyLocation {
  location?: string | null;
  address?: { postalAddress?: AshbyPostalAddress | null } | null;
}

interface AshbyCompensationComponent {
  compensationType?: string | null;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

export interface AshbyJob extends AshbyLocation {
  id: string;
  title: string;
  department?: string | null;
  jobUrl: string;
  publishedAt?: string | null;
  employmentType?: string | null;
  workplaceType?: string | null;
  isRemote?: boolean | null;
  secondaryLocations?: AshbyLocation[] | null;
  descriptionPlain?: string | null;
  descriptionHtml?: string | null;
  compensation?: { summaryComponents?: AshbyCompensationComponent[] | null } | null;
}

interface AshbyBoard {
  jobs?: AshbyJob[] | null;
}

/** Czech place names as Ashby writes them in location strings and addresses. */
const CZECH = /\b(czechia|czech|prague|praha|brno|olomouc|ostrava|plzen|pilsen|liberec|zlin|budejovice|cz)\b/;
/** Text that makes a remote job reachable from Czechia: "Europe", "EU", "Worldwide". */
const EUROPE = /\b(europe|european|eu|emea|worldwide|anywhere|global)\b/;
/** CET/CEST (UTC+1/+2) is Czech time; a remote UTC/GMT band covering +1 or +2 is EU-reachable. */
const CET = /\bces?t\b/;
const UTC_OFFSET = /(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?:\s*(?:to|-|–|—)\s*(?:utc|gmt)?\s*([+-])\s*(\d{1,2}))?/g;

/** A remote place text whose UTC/GMT offset band includes +1 or +2 (CET/CEST). */
function utcBandIncludesCz(text: string): boolean {
  if (CET.test(text)) return true;
  UTC_OFFSET.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UTC_OFFSET.exec(text)) !== null) {
    const first = (match[1] === "-" ? -1 : 1) * Number(match[2]);
    const second = match[3] === undefined ? first : (match[3] === "-" ? -1 : 1) * Number(match[4]);
    const lo = Math.min(first, second);
    const hi = Math.max(first, second);
    if (lo <= 2 && hi >= 1) return true;
  }
  return false;
}

const MODE_TAGS: Record<string, string> = {
  remote: "fully remote",
  hybrid: "hybrid work",
  onsite: "on-site",
};

function placeTexts(job: AshbyJob): string[] {
  const of = (loc: AshbyLocation | null | undefined): string[] => {
    const address = loc?.address?.postalAddress ?? {};
    return [loc?.location, address.addressLocality, address.addressRegion, address.addressCountry]
      .map((text) => foldDiacritics(text ?? "").toLowerCase())
      .filter((text) => text.length > 0);
  };
  return [...of(job), ...(job.secondaryLocations ?? []).flatMap(of)];
}

/** Czech location anywhere, or a remote job whose location text is Europe/worldwide/unspecified. */
export function isRelevant(job: AshbyJob): boolean {
  const texts = placeTexts(job);
  if (texts.some((text) => CZECH.test(text))) return true;
  const remote = job.isRemote === true || /remote/i.test(job.workplaceType ?? "");
  // A bare "remote" place text names no region: unspecified, like an empty location.
  const specified = texts.filter((text) => text.trim() !== "remote");
  return remote && (specified.length === 0 || specified.some((text) => EUROPE.test(text) || utcBandIncludesCz(text)));
}

function workMode(job: AshbyJob): string | null {
  const kind = (job.workplaceType ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return MODE_TAGS[kind] ?? (job.isRemote === true ? "fully remote" : null);
}

function employmentTag(job: AshbyJob): string | null {
  const type = job.employmentType?.trim() ?? "";
  if (type === "") return null;
  return /^contract/i.test(type) ? "contractor" : type;
}

function salary(job: AshbyJob): Pick<RawOffer, "salaryMin" | "salaryMax" | "currency"> {
  const component = (job.compensation?.summaryComponents ?? []).find(
    (c) => c.compensationType === "Salary" && (c.minValue != null || c.maxValue != null),
  );
  return {
    salaryMin: component?.minValue ?? null,
    salaryMax: component?.maxValue ?? null,
    currency: component?.currencyCode ?? null,
  };
}

function toRawOffer(job: AshbyJob, company: string): RawOffer {
  const description = job.descriptionPlain?.trim() ?? "";
  const mode = workMode(job);
  const tags = [mode, employmentTag(job), job.location?.trim() ?? null].filter(
    (tag): tag is string => Boolean(tag),
  );
  const { descriptionHtml: _html, descriptionPlain: _plain, ...raw } = job;
  return {
    source: SOURCE,
    sourceId: job.id,
    url: job.jobUrl,
    title: job.title,
    company,
    locationText: job.location?.trim() || null,
    // A fully remote job's postal address is the company seat, not where the work happens.
    city: mode === "fully remote" ? null : job.address?.postalAddress?.addressLocality?.trim() || null,
    ...salary(job),
    publishedAt: job.publishedAt ?? null,
    description,
    tags,
    partial: description === "",
    raw,
  };
}

export function parseBoard(body: string, company: string, departments?: string[]): RawOffer[] {
  const board = JSON.parse(body) as AshbyBoard;
  return (board.jobs ?? [])
    .filter((job) => job.id.length > 0 && isRelevant(job))
    .filter((job) => !departments || departments.includes(job.department ?? ""))
    .map((job) => toRawOffer(job, company));
}
