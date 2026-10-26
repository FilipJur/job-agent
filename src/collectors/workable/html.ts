/** Tags that end a block of text: replaced by a line break before tag stripping. */
const BLOCK_END = /<\s*\/\s*(?:p|div|h[1-6]|li|ul|ol|tr|table|section|blockquote)\s*>|<\s*br\s*\/?\s*>/gi;
const TAG = /<[^>]*>/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  euro: "€",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** Plain text of an HTML fragment: block tags become line breaks, inline tags are dropped, entities decoded. */
export function htmlToText(html: string): string {
  const lines = html.replace(BLOCK_END, "\n").replace(TAG, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const text = decodeEntities(line).replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out.join("\n");
}
