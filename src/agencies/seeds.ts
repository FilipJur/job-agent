import { existsSync, readFileSync } from "node:fs";
import type { AgencySeed } from "../types";

/** The agency list with research notes is private user data: `data/agencies.json` (gitignored), not the repo. */
export function agencySeedsPath(): string {
  return process.env.AGENCIES_PATH || "data/agencies.json";
}

/** Reads the agency seed list; a missing file means no agencies to seed. */
export function readAgencySeeds(): AgencySeed[] {
  const path = agencySeedsPath();
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array of agencies`);
  return parsed as AgencySeed[];
}
