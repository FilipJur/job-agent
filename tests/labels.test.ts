import { describe, expect, test } from "bun:test";
import { applyRules, type LabelInput } from "../src/labels/apply";
import type { LabelRule } from "../src/labels/rules";

const EMPTY: LabelInput = { title: "", description: "", tags: "", city: "" };
const labelsOf = (input: Partial<LabelInput>): string[] => applyRules({ ...EMPTY, ...input }).sort();

describe("contract form", () => {
  test("HPP and IČO both apply (labels are independent)", () => {
    expect(labelsOf({ description: "Nabízíme HPP nebo spolupráci na IČO." })).toEqual(["hpp", "ico"]);
  });

  test("'plný úvazek' with IČO gives ico only, not hpp", () => {
    expect(labelsOf({ tags: "Práce na plný úvazek", description: "práce na živnostenský list (IČO)" })).toEqual(["ico"]);
  });
});

describe("exclusion", () => {
  test("lektor title is excluded", () => {
    expect(labelsOf({ title: "Lektor angličtiny" })).toContain("excluded");
  });

  test("lowercase 'latte' (the drink) is not excluded", () => {
    expect(labelsOf({ title: "Barista", description: "latte art" })).not.toContain("excluded");
  });

  test("'obchodník' only in description does NOT exclude", () => {
    expect(labelsOf({ title: "AI engineer", description: "Spolupracujeme s obchodníky." })).not.toContain(
      "excluded",
    );
  });
});

describe("work mode", () => {
  test("'Práce převážně z domova' tag -> remote", () => {
    expect(labelsOf({ tags: "Práce převážně z domova" })).toEqual(["remote"]);
  });

  test("'Možnost občasné práce z domova' tag -> hybrid", () => {
    expect(labelsOf({ tags: "Možnost občasné práce z domova" })).toEqual(["hybrid"]);
  });

  test("'hybridní mobilní aplikace' (no work mode) is not hybrid", () => {
    expect(
      labelsOf({ description: "Vyvíjíme hybridní mobilní aplikace pro iOS a Android." }),
    ).not.toContain("hybrid");
  });
});

describe("place", () => {
  test("city near Olomouc -> okoli-olomouce only", () => {
    const labels = labelsOf({ city: "Přerov" });
    expect(labels).toEqual(["okoli-olomouce"]);
    expect(labels).not.toContain("olomouc");
  });

  test("'Olomoucký' (region) is not an Olomouc city match", () => {
    expect(labelsOf({ city: "Olomoucký" })).toEqual([]);
  });

  test("city rules ignore title and description mentions", () => {
    expect(labelsOf({ title: "Olomouc office", description: "Praha" })).toEqual([]);
  });
});

describe("content", () => {
  test("lowercase verb 'react' is not react-ts", () => {
    expect(labelsOf({ description: "we react quickly" })).not.toContain("react-ts");
  });
});

describe("rules are data", () => {
  test("applyRules honors a custom rule list", () => {
    const custom: LabelRule[] = [{ label: "custom", matchers: [{ fields: ["title"], pattern: /zebra/i }] }];
    expect(applyRules({ ...EMPTY, title: "Zebra keeper" }, custom)).toEqual(["custom"]);
    expect(applyRules({ ...EMPTY, title: "Senior AI Engineer", description: "LLM" }, custom)).toEqual([]);
  });

  test("an empty rule list yields no labels", () => {
    expect(applyRules({ ...EMPTY, title: "LLM Lektor", tags: "FULL_TIME" }, [])).toEqual([]);
  });
});
