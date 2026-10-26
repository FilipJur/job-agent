import { parseArgs } from "node:util";
import { createAshbyCollector } from "../collectors/ashby";
import { createHnCollector } from "../collectors/hn";
import { createJobsCzCollector } from "../collectors/jobscz";
import { createHttpClient } from "../collectors/jobscz/http";
import { createStartupJobsCollector } from "../collectors/startupjobs";
import { createWorkableCollector } from "../collectors/workable";
import { openDb } from "../db";
import { createCachedFetch, type HttpMode } from "../http-cache";
import { runCollectors, storedDetailError } from "../pipeline";
import type { Collector, FetchText } from "../types";

type Ctx = { fetchText: FetchText; limit: number | null; isKnown: (id: string) => boolean };
export const COLLECTORS: Record<string, (ctx: Ctx) => Collector> = {
  ashby: ({ fetchText, limit }) =>
    createAshbyCollector({ fetchText, ...(limit === null ? {} : { maxOrgs: limit }) }),
  hn: ({ fetchText, limit }) => createHnCollector({ fetchText, limit }),
  jobscz: ({ fetchText, limit, isKnown }) =>
    createJobsCzCollector({
      fetchText,
      isKnown,
      ...(limit === null ? {} : { maxPagesPerKeyword: 1, maxDetails: limit }),
    }),
  startupjobs: ({ fetchText, limit, isKnown }) =>
    createStartupJobsCollector({
      fetchText,
      isKnown,
      ...(limit === null ? {} : { maxDetails: limit }),
    }),
  workable: ({ fetchText, limit }) => createWorkableCollector({ fetchText, limit }),
};

const keyOf = (source: string, id: string): string => `${source}\0${id}`;

async function main(argv: string[]): Promise<void> {
  let sources: string[];
  let limit: number | null;
  let mode: HttpMode;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { source: { type: "string", multiple: true }, limit: { type: "string" } },
      strict: false,
      allowPositionals: true,
    });
    const rawLimit = values.limit as string | undefined;
    if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)) {
      throw new Error(`--limit expects a positive integer, got "${rawLimit}"`);
    }
    sources = (values.source as string[] | undefined) ?? [];
    limit = rawLimit === undefined ? null : Number(rawLimit);
    mode = (process.env.HTTP_MODE ?? "live") as HttpMode;
    if (mode !== "live" && mode !== "record" && mode !== "replay") {
      throw new Error(`invalid HTTP_MODE "${mode}"; expected live, record or replay`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const names = sources.length > 0 ? [...new Set(sources)] : Object.keys(COLLECTORS);
  const unknown = names.filter((name) => !Object.hasOwn(COLLECTORS, name));
  if (unknown.length > 0) {
    const knownNames = Object.keys(COLLECTORS).join(", ");
    console.error(`unknown source: ${unknown.join(", ")} (known: ${knownNames})`);
    process.exitCode = 1;
    return;
  }

  const cache = { mode, dir: process.env.HTTP_CACHE_DIR || "data/http-cache" };
  const fetchText = createCachedFetch(createHttpClient().fetchText, cache);
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    type Row = { source: string; source_id: string; raw_json: string };
    const rows = db.query<Row, []>("SELECT source, source_id, raw_json FROM offers").all();
    const known = new Set(
      rows.filter((r) => !storedDetailError(r.raw_json)).map((r) => keyOf(r.source, r.source_id)),
    );
    const collectors = names.map((name) =>
      COLLECTORS[name]!({ fetchText, limit, isKnown: (id) => known.has(keyOf(name, id)) }),
    );

    const runs = await runCollectors(db, collectors);
    for (const r of runs) {
      const counts =
        `fetched=${r.fetched} new=${r.new} updated=${r.updated} ` +
        `partial=${r.partial} detail_errors=${r.detailErrors} errors=${r.status === "error" ? 1 : 0}`;
      const line = `${r.source}: ${r.status === "ok" ? "ok" : "ERROR"} ${counts}`;
      console.log(r.status === "ok" ? line : `${line} — ${r.error}`);
    }
    type Key = "fetched" | "new" | "updated" | "partial" | "detailErrors";
    const total = (key: Key): number => runs.reduce((acc, r) => acc + r[key], 0);
    const errors = runs.filter((r) => r.status === "error").length;
    console.log(
      `total: fetched=${total("fetched")} new=${total("new")} updated=${total("updated")} ` +
        `partial=${total("partial")} detail_errors=${total("detailErrors")} errors=${errors}`,
    );
    if (errors > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
