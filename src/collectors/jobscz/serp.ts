import { decodeEntities, stripTags } from "./html";
import { parseSalaryText } from "./salary";

export interface SerpCard {
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  locationText: string | null;
  tags: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  publishedAt: string | null;
}

const MONTHS: Record<string, number> = {
  ledna: 1,
  února: 2,
  března: 3,
  dubna: 4,
  května: 5,
  června: 6,
  července: 7,
  srpna: 8,
  září: 9,
  října: 10,
  listopadu: 11,
  prosince: 12,
};

const MS: Record<string, number> = { minut: 60_000, hodin: 3_600_000, dn: 86_400_000 };

/** Calendar date (YYYY-MM-DD) in Europe/Prague, independent of the machine time zone. */
function pragueDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * SERP status line -> publication date (YYYY-MM-DD). "Aktualizováno ..." is an update, not a publication -> null.
 * Handles "Přidáno dnes|včera|před [N] minut/hodin/dnem", and absolute "21. října" (year inferred, not after now).
 */
export function parseStatus(text: string, now: Date): string | null {
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.startsWith("aktualizováno")) return null;
  const s = t.replace(/^přidáno\s+/, "");

  if (s === "dnes") return pragueDate(now);
  if (s === "včera") return pragueDate(new Date(now.getTime() - MS.dn!));
  const rel = s.match(/^před\s+(?:(\d+)\s+)?(minut|hodin|dn)/);
  if (rel) return pragueDate(new Date(now.getTime() - Number(rel[1] ?? 1) * MS[rel[2]!]!));

  const abs = s.match(/^(\d{1,2})\.\s*([a-zá-ž]+)/);
  const month = abs ? MONTHS[abs[2]!] : undefined;
  if (!abs || !month) return null;
  const day = Number(abs[1]);
  const today = pragueDate(now);
  const year = Number(today.slice(0, 4));
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
  const date = `${year}-${mm}-${dd}`;
  return date > today ? `${year - 1}-${mm}-${dd}` : date;
}

/** Parses SERP cards in page order. Only `<article class="SearchResultCard">` blocks count; no dedup. */
export function parseSerp(html: string, now: Date = new Date()): SerpCard[] {
  const cards: SerpCard[] = [];
  for (const [, block = ""] of html.matchAll(/<article\b[^>]*\bclass="SearchResultCard"[^>]*>([\s\S]*?)<\/article>/g)) {
    const link = block.match(/<a\b[^>]*\bdata-jobad-id="(\d+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const sourceId = link[1]!;
    const title = stripTags(link[2]!);

    const status = block.match(/data-test-ad-status="[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const body = block.match(/<div\b[^>]*\bclass="SearchResultCard__body"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const badges = [...body.matchAll(/<span\b[^>]*\bclass="Tag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]!));
    const salaryBadge = badges.find((b) => /Kč|€/.test(b));
    const salary = salaryBadge ? parseSalaryText(salaryBadge) : { min: null, max: null, currency: null };
    const tags = badges.filter((b) => b && !/Kč|€/.test(b) && !/^\d[\d\s]*$/.test(b));

    const company = block.match(/<span\b[^>]*\btranslate="no"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    const locality = block.match(/<li\b[^>]*\bdata-test="serp-locality"[^>]*>([\s\S]*?)<\/li>/)?.[1];
    const locationText = locality ? stripTags(locality.replace(/<svg\b[\s\S]*?<\/svg>/g, "")) : "";

    cards.push({
      sourceId,
      url: `https://www.jobs.cz/rpd/${sourceId}/`,
      title,
      company: company ? stripTags(company) || null : null,
      locationText: locationText || null,
      tags,
      salaryMin: salary.min,
      salaryMax: salary.max,
      currency: salary.currency,
      publishedAt: status ? parseStatus(stripTags(status[1]!), now) : null,
    });
  }
  return cards;
}
