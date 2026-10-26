import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "profile.md");

/** The live profile: user data, kept in the `data/` volume. */
export function profilePath(): string {
  return process.env.PROFILE_PATH || "data/profile.md";
}

/** The template without its leading `<!-- … -->` note, which is meant for repo readers, not the model. */
export function stripTemplateComment(template: string): string {
  return template.replace(/^<!--[\s\S]*?-->\r?\n/, "");
}

/** Reads the live profile; a missing file is first created from the committed template. */
export function readProfile(): string {
  const path = profilePath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stripTemplateComment(readFileSync(TEMPLATE, "utf8")));
  }
  return readFileSync(path, "utf8");
}

export function writeProfile(text: string): void {
  const path = profilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
