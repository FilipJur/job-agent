/** `bun run agencies:crawl [--force]`: recrawl agency sites older than 7 days (or all with --force). */
import { parseArgs } from "node:util";
import { crawlAgency, isCrawlDue } from "../agencies/crawl";
import { createHttpClient } from "../collectors/jobscz/http";
import { openDb } from "../db";
import { createCachedFetch, type HttpMode } from "../http-cache";
import { listAgencies, saveAgencyCrawl } from "../repo";
import type { AgencyCrawl } from "../types";

function renderRate(crawl: AgencyCrawl): string {
  if (crawl.hourlyRate === null) return "no rate";
  return `${crawl.hourlyRate} [${crawl.rateMinCzk}–${crawl.rateMaxCzk}]`;
}

export async function main(argv: string[]): Promise<void> {
  let force: boolean;
  let mode: HttpMode;
  try {
    const { values } = parseArgs({ args: argv, options: { force: { type: "boolean" } }, strict: false, allowPositionals: true });
    force = (values.force as boolean | undefined) ?? false;
    mode = (process.env.HTTP_MODE ?? "live") as HttpMode;
    if (mode !== "live" && mode !== "record" && mode !== "replay") {
      throw new Error(`invalid HTTP_MODE "${mode}"; expected live, record or replay`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const fetchText = createCachedFetch(createHttpClient().fetchText, {
    mode,
    dir: process.env.HTTP_CACHE_DIR || "data/http-cache",
  });
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const agencies = listAgencies(db).filter((a) => a.web !== null);
    const due = force ? agencies : agencies.filter((a) => isCrawlDue(a.crawledAt, nowMs));
    for (const a of agencies) {
      if (due.some((d) => d.id === a.id)) continue;
      console.log(`${a.name}: skipped (crawled ${a.crawledAt})`);
    }
    for (const a of due) {
      const outcome = await crawlAgency(fetchText, a, nowIso);
      saveAgencyCrawl(db, a.id, outcome.crawl);
      const hiring = outcome.crawl.hiringIco ? `hiring YES: ${outcome.crawl.hiringEvidence}` : "hiring no";
      const errors = outcome.error ? ` errors=1 (${outcome.error})` : "";
      console.log(`${a.name}: ${hiring} | rate: ${renderRate(outcome.crawl)} | pages=${outcome.pagesFetched}${errors}`);
    }
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
