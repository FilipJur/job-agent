import { createJobsCzCollector, type FetchText, type JobsCzOptions } from "../collectors/jobscz";
import { createHttpClient } from "../collectors/jobscz/http";
import { openDb } from "../db";
import { createCachedFetch } from "../http-cache";
import { runCollectors } from "../pipeline";
import type { Collector } from "../types";

export interface ParsedArgs {
  /** Empty means every registered collector. */
  sources: string[];
  /** `--limit N`; null keeps collector defaults. */
  limit: number | null;
}

export type HttpMode = "live" | "record" | "replay";

export interface CollectorContext {
  fetchText: FetchText;
  /** One SERP page and at most N detail fetches when set, collector defaults otherwise. */
  limit: number | null;
  isKnown: (sourceId: string) => boolean;
}

/** `--limit` mapping: one SERP page, at most N detail fetches; no maxima keeps collector defaults. */
export function collectorOptions(limit: number | null): Pick<JobsCzOptions, "maxPagesPerKeyword" | "maxDetails"> {
  return limit === null ? {} : { maxPagesPerKeyword: 1, maxDetails: limit };
}

/** `--source` name -> collector factory. Collectors stay DB-free; the CLI injects the known-offer lookup. */
export const COLLECTORS: Record<string, (ctx: CollectorContext) => Collector> = {
  jobscz: ({ fetchText, limit, isKnown }) =>
    createJobsCzCollector({
      fetchText,
      isKnown,
      ...collectorOptions(limit),
    }),
};

export function parseArgs(argv: string[]): ParsedArgs {
  const sources: string[] = [];
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--source=")) {
      sources.push(valueOf("--source", arg.slice("--source=".length)));
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parseLimit(valueOf("--limit", arg.slice("--limit=".length)));
      continue;
    }
    if (arg === "--source" || arg === "--limit") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      i++;
      if (arg === "--source") sources.push(value);
      else limit = parseLimit(value);
      continue;
    }
    // Anything else (positionals, `--help`) is ignored on purpose.
  }
  return { sources: [...new Set(sources)], limit };
}

function valueOf(flag: string, value: string): string {
  if (value.length === 0) throw new Error(`${flag} requires a value`);
  return value;
}

function parseLimit(raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`--limit expects a positive integer, got "${raw}"`);
  return Number(raw);
}

export function parseHttpMode(raw: string | undefined): HttpMode {
  const mode = raw ?? "live";
  if (mode !== "live" && mode !== "record" && mode !== "replay") {
    throw new Error(`invalid HTTP_MODE "${mode}"; expected live, record or replay`);
  }
  return mode;
}

/** Keys of the known-offer set: a source id is only unique within its source. */
const keyOf = (source: string, sourceId: string): string => `${source}\0${sourceId}`;

async function main(argv: string[]): Promise<void> {
  let args: ParsedArgs;
  let mode: HttpMode;
  try {
    args = parseArgs(argv);
    mode = parseHttpMode(process.env.HTTP_MODE);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const names = args.sources.length > 0 ? args.sources : Object.keys(COLLECTORS);
  const unknown = names.filter((name) => !Object.hasOwn(COLLECTORS, name));
  if (unknown.length > 0) {
    console.error(`unknown source: ${unknown.join(", ")} (known: ${Object.keys(COLLECTORS).join(", ")})`);
    process.exitCode = 1;
    return;
  }

  const fetchText = createCachedFetch(createHttpClient().fetchText, {
    mode,
    dir: process.env.HTTP_CACHE_DIR || "data/http-cache",
  });

  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const seen = db.query<{ source: string; source_id: string }, []>("SELECT source, source_id FROM offers").all();
    const known = new Set(seen.map((row) => keyOf(row.source, row.source_id)));
    const collectors = names.map((name) =>
      COLLECTORS[name]!({ fetchText, limit: args.limit, isKnown: (sourceId) => known.has(keyOf(name, sourceId)) }),
    );

    const runs = await runCollectors(db, collectors);
    let fetched = 0;
    let added = 0;
    let partial = 0;
    let detailErrors = 0;
    let errors = 0;
    for (const r of runs) {
      const failed = r.status === "error" ? 1 : 0;
      fetched += r.fetched;
      added += r.new;
      partial += r.partial;
      detailErrors += r.detailErrors;
      errors += failed;
      const line = `${r.source}: ${r.status === "ok" ? "ok" : "ERROR"} fetched=${r.fetched} new=${r.new} partial=${r.partial} detail_errors=${r.detailErrors} errors=${failed}`;
      console.log(r.status === "ok" ? line : `${line} — ${r.error}`);
    }
    console.log(`total: fetched=${fetched} new=${added} partial=${partial} detail_errors=${detailErrors} errors=${errors}`);
    if (errors > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) await main(process.argv.slice(2));
