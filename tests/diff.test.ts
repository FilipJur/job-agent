import { describe, expect, test } from "bun:test";
import { collapseDiff, gapText, lineDiff } from "../web/src/diff";

describe("lineDiff", () => {
  test("add/del/same on a small example", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  test("empty side is all add or all del", () => {
    expect(lineDiff("", "x")).toEqual([{ kind: "add", text: "x" }]);
    expect(lineDiff("x", "")).toEqual([{ kind: "del", text: "x" }]);
  });
});

describe("collapseDiff", () => {
  test("collapses a long unchanged run, keeping 2 context lines each side", () => {
    const before = ["h", "1", "2", "3", "4", "5", "6", "7", "f"].join("\n");
    const after = ["h", "1", "2", "3", "4", "5", "6", "7", "F"].join("\n");
    expect(collapseDiff(lineDiff(before, after))).toEqual([
      { kind: "same", text: "h" },
      { kind: "same", text: "1" },
      { kind: "gap", count: 4 },
      { kind: "same", text: "6" },
      { kind: "same", text: "7" },
      { kind: "del", text: "f" },
      { kind: "add", text: "F" },
    ]);
  });

  test("a run that would hide a single line stays visible", () => {
    const diff = lineDiff("a\n1\n2\n3\n4\nz", "a\n1\n2\n3\n4\nZ");
    expect(collapseDiff(diff)).toEqual(diff);
  });
});

describe("gapText", () => {
  test("Czech plural forms", () => {
    expect(gapText(3)).toBe("… 3 řádky beze změny");
    expect(gapText(7)).toBe("… 7 řádků beze změny");
  });
});
