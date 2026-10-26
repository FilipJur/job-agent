const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  zwj: "\u200d",
  zwnj: "\u200c",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
};

/** Decodes named and numeric (decimal/hex) HTML entities. Unknown names are left as-is. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** Strips tags, decodes entities, collapses all whitespace (incl. NBSP/ZWJ) to single spaces. */
export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/[\s\u200b\u200d\ufeff]+/g, " ")
    .trim();
}
