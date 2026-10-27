/** `bun run agencies:crawl [--force]`: recrawl agency sites older than 7 days (or all with --force). */
import { parseArgs } from "node:util";
import { crawlAgency, isCrawlDue } from "../agencies/crawl";
import { createHttpClient } from "../collectors/jobscz/http";
import { openDb } from "../db";
import { createCachedFetch, type HttpMode } from "../http-cache";
import { listAgencies, saveAgencyCrawl } from "../repo";
import { loadScoringConfig } from "../scoring/config";
import type { JudgeOptions } from "../agencies/judge";

function renderRow(a: { devPositionOpen: boolean; positionTitle: string | null; form: string | null; devRate: string | null; aiFit: number | null }): string {
  if (!a.devPositionOpen) return `no open position (aiFit ${a.aiFit ?? "?"})`;
  return `OPEN: ${a.positionTitle ?? "?"} [${a.form ?? "?"}] rate=${a.devRate ?? "unstated"} aiFit=${a.aiFit ?? "?"}`;
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
  const apiKey = process.env.OPENCODE_GO_API_KEY ?? "";
  // Judge options without a key: crawl still fetches pages (cached/recorded), judgment is skipped per agency.
  const { config: scoringConfig } = loadScoringConfig();
  const judgeOpts: JudgeOptions | undefined =
    apiKey === ""
      ? undefined
      : {
          endpoint: scoringConfig.endpoint,
          model: scoringConfig.model,
          apiKey,
          sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
        };
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const agencies = listAgencies(db).filter((a) => a.web !== null);
    const due = force ? agencies : agencies.filter((a) => isCrawlDue(a.crawledAt, nowMs));
    for (const a of agencies) {
      if (due.some((d) => d.id === a.id)) continue;
      console.log(`${a.name}: skipped (crawled ${a.crawledAt})`);
    }
    for (const a of due) {
      const outcome = await crawlAgency(fetchText, a, nowIso, judgeOpts);
      saveAgencyCrawl(db, a.id, outcome.crawl);
      promptTokens += outcome.promptTokens;
      completionTokens += outcome.completionTokens;
      const errors = outcome.error ? ` errors=1 (${outcome.error})` : "";
      console.log(`${a.name}: ${renderRow(outcome.crawl)} | pages=${outcome.pagesFetched}${errors}`);
    }
    const cost =
      (promptTokens / 1_000_000) * scoringConfig.prices.inputPer1M + (completionTokens / 1_000_000) * scoringConfig.prices.outputPer1M;
    console.log(`tokens=${promptTokens}+${completionTokens} cost=$${cost.toFixed(4)}`);
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
