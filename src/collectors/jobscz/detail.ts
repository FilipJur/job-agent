import { decodeEntities } from "./html";
import { parseSalaryText } from "./salary";

export interface DetailData {
  shape: "jsonld" | "html" | "og";
  title: string | null;
  company: string | null;
  locationText: string | null;
  city: string | null;
  description: string;
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
  partial: boolean;
}

interface JobPostingLd {
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { streetAddress?: string; addressLocality?: string } };
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } };
}

const NO_SALARY = { salaryMin: null, salaryMax: null, currency: null };
const PLAT_NEUVEDEN = />\s*Plat neuveden\s*</;
const OG_DESCRIPTION = /<meta\b[^>]*\bproperty="og:description"[^>]*>/;
/** Widget titles: "<title> - Detail pozice | <company>" or "<title> - Vacancy detail - <company>". */
const WIDGET_TITLE = /^(.*?)\s+-\s+(?:Detail pozice|Vacancy detail)(?:\s*[|-]\s*(.*))?$/;
/** Visible labels whose values are not offer tags. */
const SKIP_LABELS: Record<string, true> = { "Firma:": true, "Místo pracoviště:": true, "Plat:": true };

/** Block boundaries become newlines; tags dropped; entities decoded; whitespace collapsed per line. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[\u200b\u200d]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Single-line text from a fragment. */
function inlineText(html: string): string {
  return htmlToText(html).replace(/\s*\n\s*/g, " ");
}

function jobPostingLd(html: string): JobPostingLd | null {
  for (const [, json = ""] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(json) as JobPostingLd & { "@type"?: string };
      if (data["@type"] === "JobPosting") return data;
    } catch {
      // not JSON: skip this block
    }
  }
  return null;
}

function jsonLdSalary(html: string, ld: JobPostingLd): { salaryMin: number | null; salaryMax: number | null; currency: string | null } {
  const value = ld.baseSalary?.value;
  // Visible "Plat neuveden" overrides bogus JSON-LD amounts seen on live pages.
  if (!value || value.unitText !== "MONTH" || PLAT_NEUVEDEN.test(html)) return NO_SALARY;
  const min = value.minValue ?? value.maxValue ?? null;
  return { salaryMin: min, salaryMax: value.maxValue ?? min, currency: min === null ? null : (ld.baseSalary?.currency ?? null) };
}

/** Labelled rows of the beta page ("Pracovní poměr:" -> "práce na plný úvazek"). */
function basicInformationTags(html: string): string[] {
  return [...html.matchAll(/BasicInformationItem__label">([\s\S]*?)<\/span>\s*<span[^>]*BasicInformationItem__value">([\s\S]*?)<\/span>/g)]
    .filter(([, label = ""]) => !SKIP_LABELS[inlineText(label)])
    .map(([, , value = ""]) => inlineText(value))
    .filter(Boolean);
}

function jsonLdDetail(html: string, ld: JobPostingLd): DetailData {
  const address = ld.jobLocation?.address;
  const city = address?.addressLocality || null;
  const locationText = [address?.streetAddress, city].filter(Boolean).join(", ") || null;
  const employment = [ld.employmentType ?? []].flat();
  return {
    shape: "jsonld",
    title: ld.title ?? null,
    company: ld.hiringOrganization?.name ?? null,
    locationText,
    city,
    description: htmlToText(ld.description ?? ""),
    tags: [...employment, ...basicInformationTags(html)],
    ...jsonLdSalary(html, ld),
    publishedAt: ld.datePosted ?? null,
    partial: false,
  };
}

/** Classic page: description is the body richtext up to the benefits block. */
function bodyHtml(html: string): string {
  const at = html.indexOf('data-jobad="body"');
  if (at < 0) return "";
  const start = html.indexOf(">", at) + 1;
  const ends = ['class="JobDescriptionBenefits', 'data-test="jd-benefits"', "Informace o pozici"]
    .map((marker) => html.indexOf(marker, start))
    .filter((i) => i >= 0);
  const cut = ends.length > 0 ? html.lastIndexOf("<", Math.min(...ends)) : html.length;
  return html.slice(start, cut);
}

function classicDetail(html: string): DetailData {
  const items = [...html.matchAll(/<div\s+data-test="jd-info-item"[\s\S]*?<\/div>/g)].map(([block = ""]) => ({
    label: inlineText(block.match(/<span\b[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ""),
    value: inlineText(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ""),
  }));
  const company = items.find((item) => item.label === "Společnost")?.value || null;
  const salary = parseSalaryText(inlineText(html.match(/<div\s+data-test="jd-salary"[\s\S]*?<\/div>/)?.[0] ?? "").replace(/^Plat\s*/, ""));
  const benefits = [...html.matchAll(/<div\s+data-test="jd-benefits"[\s\S]*?<\/div>/g)]
    .map(([block = ""]) => inlineText(block))
    .filter(Boolean);
  const otherRows = items.filter((item) => item.label !== "Společnost" && item.label !== "Plat" && item.value).map((item) => item.value);
  return {
    shape: "html",
    title: inlineText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "") || null,
    company,
    locationText: inlineText(html.match(/data-test="jd-info-location"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "") || null,
    city: null,
    description: htmlToText(bodyHtml(html)),
    tags: [...benefits, ...otherRows],
    salaryMin: salary.min,
    salaryMax: salary.max,
    currency: salary.currency,
    publishedAt: null,
    partial: false,
  };
}

/** Brand widget: only og: meta survives. Description is double-encoded. */
function ogDetail(html: string): DetailData {
  const rawTitle = decodeEntities(html.match(/<meta\b[^>]*\bproperty="og:title"[^>]*>/)?.[0].match(/\bcontent="([^"]*)"/)?.[1] ?? "").trim();
  const widget = rawTitle.match(WIDGET_TITLE);
  const descriptionTag = html.match(OG_DESCRIPTION)?.[0] ?? "";
  const encoded = descriptionTag.match(/\bcontent="([^"]*)"/)?.[1] ?? "";
  return {
    shape: "og",
    title: widget?.[1] ?? (rawTitle || null),
    company: widget?.[2]?.trim() || null,
    locationText: null,
    city: null,
    description: decodeEntities(decodeEntities(encoded)).replace(/\s+/g, " ").trim(),
    tags: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    publishedAt: null,
    partial: true,
  };
}

export function parseDetail(html: string): DetailData {
  const ld = jobPostingLd(html);
  if (ld) return jsonLdDetail(html, ld);
  if (html.includes('data-test="jd-body-richtext"') || (html.includes("<h1") && html.includes("jd-info-item"))) {
    return classicDetail(html);
  }
  if (/<meta\b[^>]*\bproperty="og:title"/.test(html)) return ogDetail(html);
  throw new Error("unrecognized jobs.cz detail page");
}
