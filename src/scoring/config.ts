import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ScoringConfig {
  model: string;
  endpoint: string;
  maxDescriptionChars: number;
  prices: { inputPer1M: number; outputPer1M: number };
}

/** Per-request timeout for the scoring API; a timeout fails one offer like any other error. */
export const SCORING_TIMEOUT_MS = 60_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadScoringConfig(): { config: ScoringConfig; profile: string } {
  const config = JSON.parse(readFileSync(join(root, "config", "scoring.json"), "utf8")) as ScoringConfig;
  const profile = readFileSync(join(root, "profile.md"), "utf8");
  return { config, profile };
}
