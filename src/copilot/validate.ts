import type { DraftSentence, DraftSentenceKind, Fact } from "../types";

/** The model's sentence before validation. */
export interface RawSentence {
  text: string;
  kind: DraftSentenceKind;
  facts: string[];
}

export interface ValidationResult {
  sentences: DraftSentence[];
  dropped: { text: string; why: string }[];
}

/** Diacritics-folded lowercase, so `Vývojář` and `vyvojar` compare equal. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Words carrying meaning: at least 4 letters, stopwords removed.
 * Czech and English function words are ignored because they prove nothing.
 */
const STOPWORDS: Record<string, true> = {
  about: true, aby: true, after: true, ale: true, also: true, and: true,
  ani: true, are: true, because: true, been: true, before: true, both: true,
  but: true, byl: true, byla: true, byli: true, bylo: true, byt: true,
  can: true, chci: true, company: true, could: true, coz: true, dale: true,
  dalsi: true, does: true, each: true, firma: true, firmy: true, from: true,
  have: true, interested: true, into: true, jako: true, jeho: true, jeji: true,
  jenz: true, job: true, jsem: true, jsme: true, jsou: true, jste: true,
  kdyz: true, ktera: true, ktere: true, ktery: true, let: true, like: true,
  looking: true, mame: true, mate: true, mezi: true, mohl: true, mohu: true,
  more: true, most: true, much: true, must: true, muzu: true, nabidce: true,
  nabidka: true, nabidku: true, nabidky: true, nase: true, nasi: true, nebo: true,
  neco: true, nez: true, offer: true, only: true, other: true, over: true,
  podle: true, position: true, pouze: true, pozice: true, pozici: true, prace: true,
  praci: true, praxe: true, pred: true, pres: true, pri: true, projekt: true,
  projektu: true, projekty: true, rad: true, rada: true, rokem: true, roku: true,
  roky: true, role: true, seeking: true, should: true, some: true, such: true,
  tady: true, take: true, takze: true, tato: true, team: true, tech: true,
  teho: true, teto: true, than: true, that: true, their: true, them: true,
  then: true, there: true, these: true, they: true, this: true, those: true,
  tuto: true, tyto: true, uz: true, vase: true, vasi: true, velmi: true,
  very: true, vice: true, vsak: true, vse: true, vyvoj: true, vyvoje: true,
  vyvoji: true, want: true, were: true, what: true, when: true, where: true,
  which: true, while: true, will: true, with: true, work: true, would: true,
  year: true, years: true, your: true, zde: true, zkusenost: true, zkusenosti: true,
  zpet: true,
};

/** Same word up to inflection: 5-letter prefix, or 4 shared letters for longer words (`astro`/`astrem`). */
const sameWord = (a: string, b: string): boolean =>
  a.slice(0, 5) === b.slice(0, 5) || (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4));

export function significantWords(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && STOPWORDS[w] !== true);
}

/** Technologies and skills a draft must not mention unless a fact states them. */
const TECH_TERMS = [
  "acf", "agentni", "agenti", "ai", "angular", "anthropic", "api", "astro", "aws", "azure", "bash", "cdn",
  "ci", "css", "cypress", "django", "docker", "drupal", "figma", "flask", "gatsby", "gcp", "git", "github",
  "go", "graphql", "html", "java", "javascript", "jest", "kotlin", "kubernetes", "langchain", "laravel",
  "latte", "linux", "llm", "magento", "mcp", "mysql", "n8n", "nette", "netlify", "next", "node", "openai",
  "pandas", "php", "playwright", "postgres", "pytorch", "python", "react", "redux", "rest", "rust", "sass",
  "scss", "seo", "shopify", "supabase", "svelte", "swift", "symfony", "tailwind", "tensorflow", "test",
  "typescript", "ui", "ux", "vite", "vue", "webpack", "woocommerce", "wordpress", "wp", "zapier",
];

/** Folded word tokens, the unit every term and number comparison works on. */
const tokensOf = (text: string): string[] =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "");

/** A term names a token by stem (`wordpress` in `wordpressem`); 1–2 letter terms must match whole (`ai`, not `tailwind`). */
const namesTerm = (term: string, token: string): boolean =>
  term.length >= 3 ? token.startsWith(term) : token === term;

/** Tech/skill terms named in the text, matched on folded word stems. */
export function techTermsIn(text: string): string[] {
  const tokens = tokensOf(text);
  return TECH_TERMS.filter((term) => tokens.some((token) => namesTerm(term, token)));
}

/** Numbers as written, `3,5` and `3.5` both `3.5`; thousands separated by a space are joined first. */
export function numbersIn(text: string): string[] {
  const joined = text.replace(/(\d)[\s\u00a0\u202f]+(?=\d{3}\b)/g, "$1");
  return (joined.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

/**
 * Spelled-out numbers 2–10 (Czech incl. common inflections, English 2–9) by folded word.
 * `one`/`ten` and Czech `jeden` are left out: they are ordinary words too.
 */
const NUMBER_WORDS: Record<string, string> = {
  dva: "2", dve: "2", dvou: "2", dvema: "2", two: "2",
  tri: "3", trech: "3", trem: "3", tremi: "3", three: "3",
  ctyri: "4", ctyrech: "4", ctyrem: "4", ctyrmi: "4", four: "4",
  pet: "5", peti: "5", five: "5",
  sest: "6", sesti: "6", six: "6",
  sedm: "7", sedmi: "7", seven: "7",
  osm: "8", osmi: "8", eight: "8",
  devet: "9", deviti: "9", nine: "9",
  deset: "10", deseti: "10",
};

/** Digits and spelled-out numbers as values, so `pět` in a claim needs a `5`/`pět` in the facts. */
function quantitiesIn(text: string): string[] {
  const words = tokensOf(text).flatMap((t) => (NUMBER_WORDS[t] === undefined ? [] : [NUMBER_WORDS[t]]));
  return [...numbersIn(text), ...words];
}

const KNOWN_KINDS: readonly DraftSentenceKind[] = ["greeting", "claim", "question", "closing"];

/**
 * Deterministic fact check, the core of the copilot: a claim must cite at least one
 * existing fact, its numbers (digits or spelled out) must appear in those facts, it must
 * share a significant word with them, and every technology it names must be stated by
 * some fact. A greeting/question/closing must not smuggle either a digit or a technology
 * that no fact states.
 */
export function validateSentences(facts: Fact[], raw: RawSentence[]): ValidationResult {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const factTokens = tokensOf(facts.map((f) => f.text).join(" \n "));
  /** Terms no fact states, checked against all facts so a true but uncited fact still counts. */
  const unstatedTech = (text: string): string[] =>
    techTermsIn(text).filter((term) => !factTokens.some((token) => namesTerm(term, token)));
  const sentences: DraftSentence[] = [];
  const dropped: { text: string; why: string }[] = [];

  for (const sentence of raw) {
    const text = sentence.text.trim();
    if (text === "") continue;
    const drop = (why: string): void => {
      dropped.push({ text, why });
    };
    if (!KNOWN_KINDS.includes(sentence.kind)) {
      drop(`neznámý typ věty ${JSON.stringify(sentence.kind)}`);
      continue;
    }
    const cited = sentence.facts;
    if (sentence.kind === "claim") {
      if (cited.length === 0) {
        drop("tvrzení bez citovaného faktu");
        continue;
      }
      const unknown = cited.filter((id) => !byId.has(id));
      if (unknown.length > 0) {
        drop(`neznámý fakt ${unknown.join(", ")}`);
        continue;
      }
      const citedText = cited.map((id) => byId.get(id)!.text).join(" \n ");
      const supported = new Set(quantitiesIn(citedText));
      const unsupported = quantitiesIn(text).filter((n) => !supported.has(n));
      if (unsupported.length > 0) {
        drop(`číslo ${unsupported.join(", ")} není v citovaných faktech`);
        continue;
      }
      const citedWords = significantWords(citedText);
      const words = significantWords(text);
      if (words.length > 0 && !words.some((w) => citedWords.some((c) => sameWord(w, c)))) {
        drop("nesdílí žádné významné slovo s citovanými fakty");
        continue;
      }
      const tech = unstatedTech(text);
      if (tech.length > 0) {
        drop(`zmiňuje ${tech.map((t) => `„${t}“`).join(", ")}, což není v žádném faktu`);
        continue;
      }
    } else {
      const digits = numbersIn(text);
      if (digits.length > 0) {
        drop(`obsahuje číslo ${digits.join(", ")}`);
        continue;
      }
      const tech = unstatedTech(text);
      if (tech.length > 0) {
        drop(`zmiňuje ${tech.map((t) => `„${t}“`).join(", ")}, což není v žádném faktu`);
        continue;
      }
    }
    sentences.push({ text, kind: sentence.kind, facts: cited });
  }
  return { sentences, dropped };
}

/** Greeting first, closing last, the rest as one paragraph: a ready-to-send message. */
export function composeDraftText(sentences: DraftSentence[]): string {
  const pick = (kind: DraftSentenceKind): string[] => sentences.filter((s) => s.kind === kind).map((s) => s.text);
  const blocks: string[] = [];
  const greeting = pick("greeting");
  if (greeting.length > 0) blocks.push(greeting.join("\n"));
  const body = sentences.filter((s) => s.kind === "claim" || s.kind === "question").map((s) => s.text);
  if (body.length > 0) blocks.push(body.join(" "));
  const closing = pick("closing");
  if (closing.length > 0) blocks.push(closing.join("\n"));
  return blocks.join("\n\n");
}
