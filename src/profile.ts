import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "profile.md");

/** The live profile: user data, kept in the `data/` volume. */
export function profilePath(): string {
  return process.env.PROFILE_PATH || "data/profile.md";
}

/** Reads the live profile; a missing file is first created from the committed template. */
export function readProfile(): string {
  const path = profilePath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(TEMPLATE, path);
  }
  return readFileSync(path, "utf8");
}

export function writeProfile(text: string): void {
  const path = profilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
