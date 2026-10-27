/**
 * Agency page-text helpers: HTML → plain text shared by the crawler and tests.
 * No hiring/rate judgments here — those come from the LLM rubric now.
 */

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
