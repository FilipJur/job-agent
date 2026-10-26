import { foldDiacritics } from "../../text";
import type { RawOffer } from "../../types";

export const SOURCE = "ashby";

export interface AshbyOrg {
  id: string;
  name: string;
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
/** Text that makes a remote job reachable from Czechia: "Remote (UTC+1)", "Europe", "EU", "Worldwide". */
const EUROPE = /\b(europe|european|eu|emea|worldwide|anywhere|global|remote)\b/;

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
  return remote && (texts.length === 0 || texts.some((text) => EUROPE.test(text)));
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
  const fullRemote = workMode(job) === "fully remote";
  const tags = [workMode(job), employmentTag(job), job.location?.trim() ?? null].filter(
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
    city: fullRemote ? null : job.address?.postalAddress?.addressLocality?.trim() || null,
    ...salary(job),
    publishedAt: job.publishedAt ?? null,
    description,
    tags,
    partial: description === "",
    raw,
  };
}

export function parseBoard(body: string, company: string): RawOffer[] {
  const board = JSON.parse(body) as AshbyBoard;
  return (board.jobs ?? [])
    .filter((job) => job.id.length > 0 && isRelevant(job))
    .map((job) => toRawOffer(job, company));
}
