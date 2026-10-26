export interface Detail {
  title: string;
  company: string | null;
  city: string | null;
  locationText: string | null;
  description: string;
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
}

/** `unreadable`: HTTP 200 without a JobPosting node (page structure changed or a half-broken page). */
export type DetailResult =
  | { kind: "ok"; detail: Detail }
  | { kind: "expired" }
  | { kind: "unreadable" };

/** A closed offer stays at HTTP 200 and only changes its visible text. */
const EXPIRED = /vypršela platnost|již není aktuální/i;

interface JobPostingLd {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressCountry?: string } };
  jobLocationType?: string;
  applicantLocationRequirements?: { name?: string };
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** HTML fragment -> plain text: block boundaries become line breaks, tags dropped, entities decoded. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[\u200b\u200d\ufeff]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function isJobPosting(value: unknown): value is JobPostingLd {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as JobPostingLd)["@type"];
  return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
}

/** First JobPosting node of the page's JSON-LD, also when wrapped in `@graph`. */
function jobPosting(html: string): JobPostingLd | null {
  for (const [, json = ""] of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      continue; // not JSON: skip this block
    }
    const graph = typeof data === "object" && data !== null && "@graph" in data ? data["@graph"] : undefined;
    const candidates = Array.isArray(graph) ? graph : Array.isArray(data) ? data : [data];
    const found = candidates.find(isJobPosting);
    if (found) return found;
  }
  return null;
}

/** Only monthly amounts fit the integer salary columns; hourly/daily rates stay in `raw`. */
function salary(ld: JobPostingLd): { salaryMin: number | null; salaryMax: number | null; currency: string | null } {
  const value = ld.baseSalary?.value;
  const none = { salaryMin: null, salaryMax: null, currency: null };
  if (!value || !/^MONTH$/i.test(value.unitText ?? "")) return none;
  const min = value.minValue !== undefined && value.minValue > 0 ? value.minValue : null;
  const max = value.maxValue !== undefined && value.maxValue > 0 ? value.maxValue : null;
  if (min === null && max === null) return none;
  return { salaryMin: min ?? max, salaryMax: max ?? min, currency: ld.baseSalary?.currency ?? null };
}

export function parseDetail(body: string): DetailResult {
  const ld = jobPosting(body);
  if (!ld) return EXPIRED.test(body) ? { kind: "expired" } : { kind: "unreadable" };

  const address = ld.jobLocation?.address;
  const locality = address?.addressLocality?.trim() || null;
  const country = address?.addressCountry?.trim() || null;
  const applicant = ld.applicantLocationRequirements?.name?.trim() || null;
  const types = (Array.isArray(ld.employmentType) ? ld.employmentType : [ld.employmentType]).filter(
    (type): type is string => typeof type === "string",
  );

  const tags = new Set<string>(types.map((type) => (type.toUpperCase() === "CONTRACTOR" ? "contractor" : type)));
  if ((ld.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE") tags.add("fully remote");
  for (const raw of [locality, country, applicant]) if (raw) tags.add(raw);

  return {
    kind: "ok",
    detail: {
      title: ld.title?.trim() ?? "",
      company: ld.hiringOrganization?.name?.trim() || null,
      city: locality,
      locationText: [locality, country].filter(Boolean).join(", ") || applicant,
      description: htmlToText(ld.description ?? ""),
      tags: [...tags],
      ...salary(ld),
      publishedAt: ld.datePosted ?? null,
    },
  };
}
