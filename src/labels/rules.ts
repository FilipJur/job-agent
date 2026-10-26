/**
 * Rule-based labels. This file is the only place that decides which text
 * produces which label. Add or change a label by editing data here.
 *
 * Matching runs on diacritics-folded text with case preserved, so write
 * patterns without diacritics ("ICO", "prace") and set `i` where case
 * does not matter. A label applies when ANY matcher hits ANY of its fields.
 *
 * Fields:
 *   title        offer title
 *   description  offer body text
 *   tags         source badges/facts (SERP badges, contract type, benefits, JSON-LD employmentType)
 *   city         derived city
 */
export type RuleField = "title" | "description" | "tags" | "city";

export interface Matcher {
  fields: RuleField[];
  pattern: RegExp;
}

export interface LabelRule {
  label: string;
  matchers: Matcher[];
}

const TEXT: RuleField[] = ["title", "description", "tags"];

export const LABEL_RULES: LabelRule[] = [
  // --- contract form ---
  {
    label: "hpp",
    matchers: [
      { fields: TEXT, pattern: /pracovni smlouv/i },
      { fields: TEXT, pattern: /\bHPP\b/i },
      { fields: TEXT, pattern: /zamestnaneck\w* pomer/i },
    ],
  },
  {
    label: "ico",
    matchers: [
      { fields: TEXT, pattern: /\bICO\b/i },
      { fields: TEXT, pattern: /zivnost/i },
      { fields: TEXT, pattern: /\bOSVC\b/i },
      { fields: TEXT, pattern: /kontraktor|contractor/i },
      { fields: TEXT, pattern: /freelanc/i },
      { fields: ["tags"], pattern: /\bCONTRACTOR\b/ },
    ],
  },
  {
    label: "dpp-dpc",
    matchers: [
      { fields: TEXT, pattern: /\bDPP\b|\bDPC\b/i },
      { fields: TEXT, pattern: /dohod\w* o (provedeni prace|pracovni cinnosti)/i },
    ],
  },

  // --- work mode ---
  {
    label: "remote",
    matchers: [
      { fields: TEXT, pattern: /prace prevazne z domova/i },
      { fields: TEXT, pattern: /plne remote|fully remote|full remote|100 ?% remote/i },
      { fields: ["title"], pattern: /\bremote\b/i },
    ],
  },
  {
    label: "hybrid",
    matchers: [
      { fields: TEXT, pattern: /obcasn\w* prace z domova/i },
      // Bare "hybrid" also describes hybrid mobile apps, clouds and cars;
      // only work-mode phrasing counts.
      {
        fields: TEXT,
        pattern:
          /\bhybrid\w*[\s-]+(work|working|model|mode|setup|role|office|arrangement|rezim|prace|pracovni|spoluprace|forma)\w*/i,
      },
    ],
  },
  {
    label: "onsite",
    matchers: [
      { fields: TEXT, pattern: /\bon-?site\b/i },
      { fields: TEXT, pattern: /pouze v kancelari|prace na pracovisti|prace v kancelari/i },
    ],
  },

  // --- place ---
  { label: "olomouc", matchers: [{ fields: ["city"], pattern: /^Olomouc$/i }] },
  {
    label: "okoli-olomouce",
    matchers: [{ fields: ["city"], pattern: /^(Prerov|Prostejov|Sternberk|Unicov|Litovel)$/i }],
  },
  { label: "praha", matchers: [{ fields: ["city"], pattern: /^Praha$/i }] },

  // --- content ---
  {
    label: "ai-first",
    matchers: [
      {
        fields: ["title", "description"],
        pattern: /\bLLMs?\b|\bAI[- ]agent|\bagentic\b|Claude Code|\bCursor\b|\bMCP\b|\bRAG\b|prompt engineering/i,
      },
    ],
  },
  {
    label: "react-ts",
    matchers: [
      // Case-sensitive: "react" is also an ordinary verb.
      { fields: ["title", "description"], pattern: /\bReact(\.?js)?\b/ },
      { fields: ["title", "description"], pattern: /\bTypeScript\b/i },
    ],
  },
  { label: "wordpress", matchers: [{ fields: ["title", "description"], pattern: /\bwordpress\b/i }] },

  // --- exclusion flag ---
  {
    label: "excluded",
    matchers: [
      // Role type is judged from the title only; bodies mention "sales" etc. in passing.
      { fields: ["title"], pattern: /\blektor|\bskolitel|\blektoring/i },
      { fields: ["title"], pattern: /\bobchodn(ik|ice)\b|\bsales\b|obchodni konzultant/i },
      // Nette/Latte are stack requirements; case-sensitive so "latte" the drink does not count.
      { fields: ["title", "description"], pattern: /\bNette\b|\bLatte\b/ },
    ],
  },
];
