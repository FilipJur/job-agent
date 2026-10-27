import { describe, expect, test } from "bun:test";
import { parseFacts } from "../src/copilot/facts";
import { composeDraftText, validateSentences, type RawSentence } from "../src/copilot/validate";
import type { Fact } from "../src/types";

const FACTS: Fact[] = [
  { id: "F1", text: "Aktuálně pracuje jako subdodavatel přes agenturu." },
  { id: "F2", text: "WordPress a WooCommerce: PHP, child themes, ACF." },
  { id: "F3", text: "Za sebou má 3,5 roku praxe s PHP." },
  { id: "F4", text: "AI-assisted vývoj: coding agenti, MCP, routování modelů." },
];

const verdicts = (sentences: RawSentence[]): { kept: string[]; why: string[] } => {
  const { sentences: kept, dropped } = validateSentences(FACTS, sentences);
  return { kept: kept.map((s) => s.text), why: dropped.map((d) => d.why) };
};

describe("parseFacts", () => {
  test("numbers the `- ` lines in file order across sections and ignores comments and prose", () => {
    const text = "<!-- note\nmore note -->\n# Fakta\n\nÚvodní věta.\n\n## Sekce\n- První fakt.\n-  Druhý fakt.  \n  pokračování\n\n* odrážka\n";
    expect(parseFacts(text)).toEqual([
      { id: "F1", text: "První fakt." },
      { id: "F2", text: "Druhý fakt." },
    ]);
  });
});

describe("claim validation", () => {
  test("uncited claim and unknown fact id are dropped", () => {
    expect(verdicts([{ text: "Umím PHP.", kind: "claim", facts: [] }]).why).toEqual(["tvrzení bez citovaného faktu"]);
    expect(verdicts([{ text: "Umím PHP.", kind: "claim", facts: ["F9"] }]).why).toEqual(["neznámý fakt F9"]);
  });

  test("a number missing from the cited facts is dropped; the same number in them is kept", () => {
    expect(verdicts([{ text: "Mám 5 let praxe s PHP.", kind: "claim", facts: ["F3"] }])).toMatchObject({
      kept: [],
      why: ["číslo 5 není v citovaných faktech"],
    });
    expect(verdicts([{ text: "Mám 3,5 roku praxe s PHP.", kind: "claim", facts: ["F3"] }]).kept).toEqual([
      "Mám 3,5 roku praxe s PHP.",
    ]);
  });

  test("a claim sharing no word with its cited facts is dropped, a supported one kept", () => {
    expect(verdicts([{ text: "Pracuji s Pythonem.", kind: "claim", facts: ["F2"] }]).kept).toEqual([]);
    expect(verdicts([{ text: "Dělám WordPress s ACF.", kind: "claim", facts: ["F2"] }]).kept).toEqual([
      "Dělám WordPress s ACF.",
    ]);
  });

  test("greeting and question carrying a digit or an unstated technology are dropped", () => {
    expect(verdicts([{ text: "Dobrý den, mám 5 let praxe.", kind: "greeting", facts: [] }]).why).toEqual([
      "obsahuje číslo 5",
    ]);
    expect(verdicts([{ text: "Umíte Vue?", kind: "question", facts: [] }]).why).toEqual([
      "zmiňuje „vue“, což není v žádném faktu",
    ]);
    expect(verdicts([{ text: "Jakou sazbu nabízíte?", kind: "question", facts: [] }]).kept).toEqual([
      "Jakou sazbu nabízíte?",
    ]);
  });
});

describe("composeDraftText", () => {
  test("greeting first, closing last, the rest in one paragraph", () => {
    const { sentences } = validateSentences(FACTS, [
      { text: "Dobrý den,", kind: "greeting", facts: [] },
      { text: "Dělám WordPress.", kind: "claim", facts: ["F2"] },
      { text: "Jakou sazbu nabízíte?", kind: "question", facts: [] },
      { text: "Děkuji, Filip", kind: "closing", facts: [] },
    ]);
    expect(composeDraftText(sentences)).toBe(
      "Dobrý den,\n\nDělám WordPress. Jakou sazbu nabízíte?\n\nDěkuji, Filip",
    );
  });
});
