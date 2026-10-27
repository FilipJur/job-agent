/** Pure text analysis for the agency website crawl: IČO-hiring evidence and hourly rates. */

const ICO_RE = /\b(ičo|živnost\w*|osvč|freelance\w*|externí\s+spolupr\w+|externist\w*|subdodavatel\w*)\b/i;

const HIRE_RE = /(hled[áa]\w*|p[řr]idej\w*|nab[íi]r[áa]\w*|nab[íi]z\w*|voln\w*\s+pozic\w+|spolupr\w*)/i;

/** Generic "we work with freelancers" with no open call: must not count as hiring. */
const GENERIC_COOP_RE = /\bspolupracujeme\s+s\b/i;

const ENTITIES: Record<string, string> = {
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
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** HTML → plain text, keeping block boundaries as newlines for sentence splitting. */
export function pageText(html: string): string {
  const withoutBoilerplate = html.replace(/<(script|style|noscript|header|footer|nav)[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  const withBreaks = withoutBoilerplate
    .replace(/<(br|p|div|h[1-6]|li|tr|section|article|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(withBreaks)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n[ \t ]*\n+/g, "\n")
    .trim();
}

export function splitSentences(text: string): string[] {
  const blocks: string[] = [];
  for (const block of text.split("\n")) {
    const clean = block.replace(/\s+/g, " ").trim();
    if (clean.length <= 1) continue;
    if (clean.length <= 400) blocks.push(clean);
    else for (const chunk of clean.split(/[;•·|]\s+/)) if (chunk.trim().length > 1) blocks.push(chunk.trim());
  }
  return blocks.flatMap((b) =>
    b
      .split(/(?<=[.!?…])\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1),
  );
}

/** First sentence proving an open IČO/freelance call, or null. */
export function findHiringEvidence(text: string): string | null {
  for (const s of splitSentences(text)) {
    if (s.length > 2000 || GENERIC_COOP_RE.test(s)) continue;
    if (ICO_RE.test(s) && HIRE_RE.test(s)) return s.length > 200 ? `${s.slice(0, 199)}…` : s;
  }
  return null;
}

const AMOUNT = String.raw`(\d[\d\s ]*(?:[.,]\d+)?)`;
const RATE_RE = new RegExp(`${AMOUNT}\\s*(?:[–—\\-]|až|\\bdo\\b)?\\s*${AMOUNT}?\\s*kč`, "gi");
const HOURLY_CTX_RE = /(\/\s*h\b|\bhod(?:\.|in\w*)?\b|\bsazb\w*)/i;

function parseAmount(raw: string): number {
  const t = raw.replace(/[\s ]/g, "");
  const dottedThousands = /^(\d{1,3})(\.\d{3})+$/.exec(t);
  return Math.round(parseFloat(dottedThousands ? t.replace(/\./g, "") : t.replace(",", ".")));
}

export function formatCzk(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export interface ParsedRate {
  min: number;
  max: number;
  /** Normalized "500 Kč/h" / "450–600 Kč/h". */
  text: string;
}

/** First hourly amount in the text, or null: /h suffix or hodin/sazba words within 60 chars. */
export function parseRate(text: string): ParsedRate | null {
  RATE_RE.lastIndex = 0;
  for (const m of text.matchAll(RATE_RE)) {
    const full = m[0];
    const at = m.index ?? 0;
    if (!HOURLY_CTX_RE.test(text.slice(Math.max(0, at - 60), at + full.length + 60))) continue;
    const min = parseAmount(m[1] ?? "");
    const rawMax = m[2] ? parseAmount(m[2]) : min;
    if (!Number.isFinite(min) || min <= 0) continue;
    const max = Number.isFinite(rawMax) && rawMax >= min ? rawMax : min;
    return { min, max, text: min === max ? `${formatCzk(min)} Kč/h` : `${formatCzk(min)}–${formatCzk(max)} Kč/h` };
  }
  return null;
}
