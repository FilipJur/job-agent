import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { buildDigest, renderDigest } from "./build";
import { pushDigest } from "./push";

export interface RunDigestOptions {
  db: Database;
  now?: Date;
  digestDir?: string;
  ntfyUrl?: string;
  jobAgentUrl?: string;
  fetchFn?: typeof fetch;
  dryRun?: boolean;
}

export interface RunDigestResult {
  title: string;
  markdown: string;
  short: string;
  since: string;
  now: string;
  wrote: boolean;
  pushed: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

export function digestDirOf(): string {
  return process.env.DIGEST_DIR || "data/digest";
}

/** Previous digest's `now` from `last.json`, else 24 h back; a corrupt file falls back too. */
export function readSince(dir: string, now: Date): string {
  const fallback = new Date(now.getTime() - DAY_MS).toISOString();
  const path = join(dir, "last.json");
  if (!existsSync(path)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { now?: unknown };
    if (typeof raw.now === "string" && !Number.isNaN(Date.parse(raw.now))) return raw.now;
  } catch {
    // Corrupt state: fall back to the last 24 h rather than failing the run.
  }
  return fallback;
}

/**
 * Builds the digest, writes `<date>.md` + `last.json` (unless `dryRun`), and
 * pushes via ntfy only when a URL is set. Push failures are printed with the
 * secret URL redacted and never throw.
 */
export async function runDigest(opts: RunDigestOptions): Promise<RunDigestResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const dir = opts.digestDir ?? digestDirOf();
  const since = readSince(dir, now);
  const { title, markdown, short } = renderDigest(buildDigest(opts.db, { since, now: nowIso }));
  if (opts.dryRun === true) return { title, markdown, short, since, now: nowIso, wrote: false, pushed: false };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${nowIso.slice(0, 10)}.md`), markdown);
  writeFileSync(join(dir, "last.json"), `${JSON.stringify({ now: nowIso })}\n`);
  let pushed = false;
  const ntfyUrl = opts.ntfyUrl ?? process.env.NTFY_URL ?? "";
  if (ntfyUrl !== "") {
    const jobAgentUrl = opts.jobAgentUrl ?? process.env.JOB_AGENT_URL ?? "";
    const result = await pushDigest({
      url: ntfyUrl,
      title,
      body: short,
      ...(jobAgentUrl === "" ? {} : { clickUrl: jobAgentUrl }),
      ...(opts.fetchFn === undefined ? {} : { fetchFn: opts.fetchFn }),
    });
    if (result.ok) {
      pushed = true;
    } else {
      console.error(`digest push failed: ${result.error.split(ntfyUrl).join("<ntfy-url>")}`);
    }
  }
  return { title, markdown, short, since, now: nowIso, wrote: true, pushed };
}
