/** Pure text analysis for the agency website crawl: IČO-hiring evidence and hourly rates. */

/** \b is ASCII-only (no boundary before "ž"), so IČO-term boundaries list Czech letters explicitly. */
const W = "A-Za-z0-9_áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ";
const ICO_RE = new RegExp(
  `(?<![${W}])(ičo|živnost\\w*|osvč|freelance\\w*|externí\\s+spolupr\\w+|externist\\w*|subdodavatel\\w*)(?![${W}])`,
  "i",
);

const HIRE_RE = /(hled[áa]\w*|p[řr]idej\w*|nab[íi]r[áa]\w*|nab[íi]z\w*|voln\w*\s+pozic\w+|spolupr\w*)/i;

/** Previous line gives an offer-list context ("Co nabízíme"), so the IČO line needs no hiring verb. */
const OFFER_CTX_RE = /(co\s+nab[íi]z\w*|nab[íi]z\w*me|benefit\w*|oček[áa]v\w*me|požaduj\w*me|popis\s+pozic\w*)/i;

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

/** HTML → plain text. Each list item becomes its own line so offer bullets stay separate. */
export function pageText(html: string): string {
  const withoutBoilerplate = html.replace(/<(script|style|noscript|header|footer|nav)[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  const withBreaks = withoutBoilerplate
    .replace(/<\/(li|ul|ol)>/gi, "\n")
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

/**
 * First evidence of an open IČO/freelance call, or null. Single lines match first
 * (exact sentence); adjacent lines pair up only for split list items like
 * "Co nabízíme" + "Práci na HPP nebo živnost". A generic "spolupracujeme
 * s freelancery" anywhere in the candidate vetoes it.
 */
export function findHiringEvidence(text: string): string | null {
  const lines = splitSentences(text);
  for (const line of lines) {
    if (line.length > 2000 || GENERIC_COOP_RE.test(line)) continue;
    if (ICO_RE.test(line) && HIRE_RE.test(line)) return line.length > 200 ? `${line.slice(0, 199)}…` : line;
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const [prev = "", cur = ""] = [lines[i], lines[i + 1]];
    if (!ICO_RE.test(cur)) continue;
    const pair = `${prev} ${cur}`;
    if (pair.length > 2000 || GENERIC_COOP_RE.test(pair)) continue;
    if (HIRE_RE.test(pair) || OFFER_CTX_RE.test(prev)) return pair.length > 200 ? `${pair.slice(0, 199)}…` : pair;
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
