import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalMetrics } from "../eval/metrics";
import { readProfile, writeProfile } from "../profile";

export type ProposalStatus = "pending" | "applied" | "rejected" | "discarded";

export interface EvalSummary {
  n: number;
  positives: number;
  negatives: number;
  auc: number | null;
  precisionAt5: number | null;
  precisionAt10: number | null;
  meanPositive: number | null;
  meanNegative: number | null;
}

export interface Proposal {
  id: string;
  createdAt: string;
  status: ProposalStatus;
  model: string;
  /** Computed on read: the live profile no longer matches `baseProfile`. */
  stale: boolean;
  rationale: string[];
  changes: string[];
  baseProfile: string;
  profile: string;
  metrics: { current: EvalSummary; proposed: EvalSummary };
  /** How the delta was measured; absent on files written before the hold-out split (= in-sample). */
  evaluation?: { kind: "holdout" | "in-sample"; n: number };
}

/** What is on disk; `stale` depends on the live profile and is never stored. */
export type StoredProposal = Omit<Proposal, "stale">;

export type ProposalAction = { ok: true } | { ok: false; status: 404 | 409; error: string };

export const proposalsDir = (): string => process.env.PROPOSALS_DIR || "data/proposals";

export const summarize = (m: EvalMetrics): EvalSummary => ({
  n: m.n,
  positives: m.positives,
  negatives: m.negatives,
  auc: m.auc,
  precisionAt5: m.precisionAt[5],
  precisionAt10: m.precisionAt[10],
  meanPositive: m.meanScore.positive,
  meanNegative: m.meanScore.negative,
});

/** `2026-10-27T10:00:00.123Z` → `2026-10-27T10-00-00Z`: sortable and safe as a file name. */
export const proposalIdOf = (createdAt: string): string => createdAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

// Ids come from URLs; anything else could escape the directory.
const ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

const fileOf = (id: string): string => join(proposalsDir(), `${id}.json`);

function readStored(id: string): StoredProposal | null {
  if (!ID_PATTERN.test(id) || !existsSync(fileOf(id))) return null;
  return JSON.parse(readFileSync(fileOf(id), "utf8")) as StoredProposal;
}

export function saveProposal(p: StoredProposal): string {
  mkdirSync(proposalsDir(), { recursive: true });
  const path = fileOf(p.id);
  writeFileSync(`${path}.tmp`, JSON.stringify(p, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
  return path;
}

/** Newest first. */
export function listProposals(): Proposal[] {
  const dir = proposalsDir();
  if (!existsSync(dir)) return [];
  const live = readProfile();
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && ID_PATTERN.test(name.slice(0, -5)))
    .sort()
    .reverse()
    .map((name) => readStored(name.slice(0, -5)))
    .filter((p): p is StoredProposal => p !== null)
    .map((p) => ({ ...p, stale: live !== p.baseProfile }));
}

export function readProposal(id: string): Proposal | null {
  const p = readStored(id);
  return p === null ? null : { ...p, stale: readProfile() !== p.baseProfile };
}

/** Writes the proposed profile only when the proposal is pending and the live profile is still its base. */
export function applyProposal(id: string): ProposalAction {
  const p = readStored(id);
  if (p === null) return { ok: false, status: 404, error: `proposal ${id} not found` };
  if (p.status !== "pending") return { ok: false, status: 409, error: `proposal is ${p.status}, not pending` };
  if (readProfile() !== p.baseProfile) {
    return { ok: false, status: 409, error: "profile changed since the proposal was made (stale)" };
  }
  writeProfile(p.profile);
  saveProposal({ ...p, status: "applied" });
  return { ok: true };
}

export function rejectProposal(id: string): ProposalAction {
  const p = readStored(id);
  if (p === null) return { ok: false, status: 404, error: `proposal ${id} not found` };
  if (p.status !== "pending") return { ok: false, status: 409, error: `proposal is ${p.status}, not pending` };
  saveProposal({ ...p, status: "rejected" });
  return { ok: true };
}

const TUNE_INTERVAL_MS = 7 * 24 * 3600 * 1000;

const ATTEMPT_FILE = "last-attempt.json";

/** Records that a tune run started, so `unchanged`/failed runs (no proposal file) still count toward the weekly cadence. */
export function markTuneAttempt(nowMs: number): void {
  mkdirSync(proposalsDir(), { recursive: true });
  writeFileSync(join(proposalsDir(), ATTEMPT_FILE), `${JSON.stringify({ at: new Date(nowMs).toISOString() })}\n`);
}

/** At most one tune attempt per 7 days, measured from the newer of the newest proposal and the last attempt. */
export function isTuneDue(nowMs: number): boolean {
  const newest = listProposals()[0];
  let last = newest === undefined ? null : Date.parse(newest.createdAt);
  try {
    const raw = JSON.parse(readFileSync(join(proposalsDir(), ATTEMPT_FILE), "utf8")) as { at?: unknown };
    if (typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at))) {
      last = Math.max(last ?? 0, Date.parse(raw.at));
    }
  } catch {
    // No marker (or a corrupt one): fall back to the newest proposal file only.
  }
  return last === null || nowMs - last >= TUNE_INTERVAL_MS;
}
