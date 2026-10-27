import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProfile } from "../profile";

export interface ScoringConfig {
  model: string;
  secondModel?: string;
  endpoint: string;
  maxDescriptionChars: number;
  prices: { inputPer1M: number; outputPer1M: number };
}

/** Per-request timeout for the scoring API; a timeout fails one offer like any other error. */
export const SCORING_TIMEOUT_MS = 60_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface ScoringFile {
  model: string;
  secondModel?: string;
  endpoint: string;
  maxDescriptionChars: number;
  prices: { inputPer1M: number; outputPer1M: number };
}

function isScoringFile(value: unknown): value is ScoringFile {
  if (typeof value !== "object" || value === null) return false;
  if (!("model" in value) || typeof value.model !== "string") return false;
  if ("secondModel" in value && typeof value.secondModel !== "string") return false;
  if (!("endpoint" in value) || typeof value.endpoint !== "string") return false;
  if (!("maxDescriptionChars" in value) || typeof value.maxDescriptionChars !== "number") return false;
  if (!("prices" in value)) return false;
  const prices = value.prices;
  if (typeof prices !== "object" || prices === null) return false;
  if (!("inputPer1M" in prices) || typeof prices.inputPer1M !== "number") return false;
  return "outputPer1M" in prices && typeof prices.outputPer1M === "number";
}

function readScoringFile(): ScoringFile {
  const parsed: unknown = JSON.parse(readFileSync(join(root, "config", "scoring.json"), "utf8"));
  if (!isScoringFile(parsed)) throw new Error("config/scoring.json has an invalid shape");
  return parsed;
}

export function loadScoringConfig(): { config: ScoringConfig; profile: string } {
  const config = readScoringFile();
  const profile = readProfile();
  return { config, profile };
}

/** The model offers are currently scored with (from config/scoring.json). */
export function scoreModel(): string {
  return readScoringFile().model;
}

/** The second-opinion model, or undefined when the feature is off. */
export function secondModel(): string | undefined {
  const file = readScoringFile();
  return file.secondModel === undefined || file.secondModel === "" ? undefined : file.secondModel;
}
