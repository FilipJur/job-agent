/** Algolia hit fields used by this collector; both endpoints return the same shape. */
export interface HnHit {
  objectID: string;
  title?: string | null;
  created_at?: string | null;
  created_at_i?: number | null;
  parent_id?: number | string | null;
  comment_text?: string | null;
  author?: string | null;
}

const HIRING_PREFIX = "Ask HN: Who is hiring?";

const hitsOf = (body: string): HnHit[] => {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("hits" in parsed) || !Array.isArray(parsed.hits)) {
    return [];
  }
  // Algolia hits: every field read below is optional or defaulted, so element validation adds nothing.
  return parsed.hits as HnHit[];
};

/** Newest story whose title is an "Ask HN: Who is hiring?" thread; the monthly thread is the collector's target. */
export function newestHiringThread(body: string): HnHit | null {
  const candidates = hitsOf(body).filter((hit) => (hit.title ?? "").startsWith(HIRING_PREFIX));
  candidates.sort((a, b) => (b.created_at_i ?? 0) - (a.created_at_i ?? 0));
  return candidates[0] ?? null;
}

/** Top-level job posts only: replies are discussion, and "Who wants to be hired?" answers are not offers. */
export function topLevelComments(body: string, storyId: string): HnHit[] {
  return hitsOf(body).filter(
    (hit) => String(hit.parent_id) === storyId && (hit.comment_text ?? "").trim() !== "",
  );
}

interface Header {
  company: string | null;
  title: string;
  locationText: string | null;
  tags: string[];
}

/** Segments that name how the work happens or the contract, never the role ("REMOTE (EU)", "Full-time"). */
const WORK_MODE = /^(remote|onsite|on-site|hybrid)\b/i;
const EMPLOYMENT = /^(full[- ]?time|part[- ]?time|contract|permanent|intern(ship)?|temporary)$/i;

/**
 * Parse the first line of a job post. The convention is `Company | Role | Location | …`;
 * the location is the first segment naming REMOTE/ONSITE, otherwise the third field.
 * Segments double as tags so rule labels can read facts like "B2B contract".
 */
export function parseHeader(line: string): Header {
  const header = line.trim();
  const segments = header.split("|").map((s) => s.trim()).filter((s) => s !== "");
  const remoteSegment = segments.find((s) => /\bREMOTE\b|\bONSITE\b/i.test(s)) ?? null;
  // Stripping tags leaves an anchor's text as a bare URL and some headers put the location second;
  // the first remaining segment is the role, else the whole header is the best title there is.
  const role =
    segments
      .slice(1)
      .find((s) => !/^<?https?:\/\//.test(s) && !WORK_MODE.test(s) && !EMPLOYMENT.test(s)) ?? null;
  const company = (segments[0] ?? "").replace(/\s*\(https?:\/\/[^)]*\)/g, "").trim();

  const tags = [...segments];
  if (/\bREMOTE\b/i.test(header)) tags.push("fully remote");
  if (/contract|freelanc|contractor/i.test(header)) tags.push("contractor");

  return {
    company: company === "" ? null : company,
    title: role ?? header,
    locationText: remoteSegment ?? segments[2] ?? null,
    tags: [...new Set(tags)],
  };
}
