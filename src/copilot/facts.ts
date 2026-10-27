import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTemplateComment } from "../profile";
import type { Fact } from "../types";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "facts.md");

/** The live facts: user data, kept in the `data/` volume. */
export function factsPath(): string {
  return process.env.FACTS_PATH || "data/facts.md";
}

/**
 * One fact per line starting with `- `, in file order (F1, F2, …).
 * HTML comments are dropped, so the template note never becomes a fact.
 */
export function parseFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const match = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) facts.push({ id: `F${facts.length + 1}`, text: match[1] });
  }
  return facts;
}

/** Reads the live facts; a missing file is first created from the committed template. */
export function readFacts(): { text: string; facts: Fact[] } {
  const path = factsPath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stripTemplateComment(readFileSync(TEMPLATE, "utf8")));
  }
  const text = readFileSync(path, "utf8");
  return { text, facts: parseFacts(text) };
}

export function writeFacts(text: string): { text: string; facts: Fact[] } {
  const path = factsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { text, facts: parseFacts(text) };
}
