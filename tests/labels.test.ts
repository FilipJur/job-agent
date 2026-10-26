import { describe, expect, test } from "bun:test";
import { applyRules, type LabelInput } from "../src/labels/apply";
import type { LabelRule } from "../src/labels/rules";

const EMPTY: LabelInput = { title: "", description: "", tags: "", city: "" };
const labelsOf = (input: Partial<LabelInput>): string[] => applyRules({ ...EMPTY, ...input }).sort();

describe("contract form", () => {
  test("HPP and IČO both apply (labels are independent)", () => {
    expect(labelsOf({ description: "Nabízíme HPP nebo spolupráci na IČO." })).toEqual(["hpp", "ico"]);
  });

  test.each(["pracovní smlouva", "Full-time"])("hpp from %p", (text) => {
    expect(labelsOf({ description: text })).toContain("hpp");
  });

  test("hpp from JSON-LD employmentType tags", () => {
    expect(labelsOf({ tags: "FULL_TIME\nEMPLOYEE" })).toEqual(["hpp"]);
  });

  test.each(["OSVČ", "živnostenský list", "živnost", "freelance"])("ico from %p", (text) => {
    expect(labelsOf({ description: text })).toEqual(["ico"]);
  });

  test.each(["DPP", "dohoda o provedení práce"])("dpp-dpc from %p", (text) => {
    expect(labelsOf({ description: text })).toEqual(["dpp-dpc"]);
  });
});

describe("exclusion", () => {
  test.each(["Lektor angličtiny", "Školitel", "Obchodní konzultant", "Sales Manager"])(
    "title %p is excluded",
    (title) => {
      expect(labelsOf({ title })).toContain("excluded");
    },
  );

  test("Nette in description is excluded", () => {
    expect(labelsOf({ title: "Senior developer", description: "Znalost Nette a PHP" })).toContain("excluded");
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

  test("neither home-office tag gives onsite", () => {
    expect(labelsOf({ tags: "Práce převážně z domova\nMožnost občasné práce z domova" })).not.toContain(
      "onsite",
    );
    expect(labelsOf({ tags: "Možnost občasné práce z domova" })).not.toContain("onsite");
  });

  test("remote and hybrid text together give both labels", () => {
    expect(labelsOf({ tags: "Práce převážně z domova\nMožnost občasné práce z domova" })).toEqual([
      "hybrid",
      "remote",
    ]);
  });

  test("remote in title -> remote", () => {
    expect(labelsOf({ title: "Backend Engineer (remote)" })).toEqual(["remote"]);
  });
});

describe("place", () => {
  test("Olomouc city -> olomouc", () => {
    expect(labelsOf({ city: "Olomouc" })).toEqual(["olomouc"]);
  });

  test.each(["Přerov", "Prostějov", "Šternberk", "Uničov", "Litovel"])("%p -> okoli-olomouce only", (city) => {
    const labels = labelsOf({ city });
    expect(labels).toEqual(["okoli-olomouce"]);
    expect(labels).not.toContain("olomouc");
  });

  test("Praha -> praha", () => {
    expect(labelsOf({ city: "Praha" })).toEqual(["praha"]);
  });

  test("'Olomoucký' (region) is not an Olomouc city match", () => {
    expect(labelsOf({ city: "Olomoucký" })).toEqual([]);
  });

  test("city rules ignore title and description mentions", () => {
    expect(labelsOf({ title: "Olomouc office", description: "Praha" })).toEqual([]);
  });
});

describe("content", () => {
  test.each(["LLM", "AI agent", "Claude Code", "MCP", "RAG", "prompt engineering"])(
    "ai-first from %p",
    (text) => {
      expect(labelsOf({ description: text })).toContain("ai-first");
    },
  );

  test.each(["storage", "garage"])("no ai-first for %p (word boundary)", (text) => {
    expect(labelsOf({ description: text })).not.toContain("ai-first");
  });

  test.each(["React", "TypeScript"])("react-ts from %p", (text) => {
    expect(labelsOf({ description: text })).toEqual(["react-ts"]);
  });

  test("lowercase verb 'react' is not react-ts", () => {
    expect(labelsOf({ description: "we react quickly" })).not.toContain("react-ts");
  });

  test("wordpress from title or description", () => {
    expect(labelsOf({ title: "WordPress developer" })).toEqual(["wordpress"]);
    expect(labelsOf({ description: "Zkušenost s WordPress" })).toEqual(["wordpress"]);
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
