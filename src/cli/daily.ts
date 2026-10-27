import { parseArgs } from "node:util";
import { crawlAgency, isCrawlDue } from "../agencies/crawl";
import type { JudgeOptions } from "../agencies/judge";
import { createHttpClient } from "../collectors/jobscz/http";
import { openDb } from "../db";
import { listAgencies, saveAgencyCrawl, seedAgencies } from "../repo";
import type { AgencySeed } from "../types";
import agencySeeds from "../../config/agencies.json";
import { createCachedFetch, type HttpMode } from "../http-cache";
import { loadScoringConfig } from "../scoring/config";
import { runScoring } from "../scoring/run";
import { COLLECTORS, collectSources, dueSources, printRuns } from "./collect";
import { printResult } from "./tune";
import { generateProposal } from "../tune/generate";
import { isTuneDue } from "../tune/proposals";

const { config: scoringConfig, profile } = loadScoringConfig();

async function main(argv: string[]): Promise<void> {
  let limit: number | null;
  let force: boolean;
  let mode: HttpMode;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { limit: { type: "string" }, force: { type: "boolean" } },
      strict: false,
      allowPositionals: true,
    });
    const rawLimit = values.limit as string | undefined;
    if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)) {
      throw new Error(`--limit expects a positive integer, got "${rawLimit}"`);
    }
    limit = rawLimit === undefined ? null : Number(rawLimit);
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

  const cache = { mode, dir: process.env.HTTP_CACHE_DIR || "data/http-cache" };
  const fetchText = createCachedFetch(createHttpClient().fetchText, cache);
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    // Idempotent: a fresh host gets its agencies, an updated checkout refreshes research fields.
    const seeded = seedAgencies(db, agencySeeds as AgencySeed[]);
    if (seeded.inserted + seeded.updated > 0) console.log(`agencies: inserted ${seeded.inserted}, updated ${seeded.updated}`);
    // Agency website crawl (7-day rule). A failure is printed, never fails the run.
    try {
      const apiKey = process.env.OPENCODE_GO_API_KEY ?? "";
      const judgeOpts: JudgeOptions | undefined =
        apiKey === ""
          ? undefined
          : {
              endpoint: scoringConfig.endpoint,
              model: scoringConfig.model,
              apiKey,
              sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
            };
      const dueAgencies = listAgencies(db).filter((a) => a.web !== null && isCrawlDue(a.crawledAt, Date.now()));
      for (const a of dueAgencies) {
        const outcome = await crawlAgency(fetchText, a, undefined, judgeOpts);
        saveAgencyCrawl(db, a.id, outcome.crawl);
      }
      console.log(`agencies crawl: ${dueAgencies.length} checked`);
    } catch (e) {
      console.error(`agencies crawl failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const names = Object.keys(COLLECTORS);
    const { due, skipped } = dueSources(db, names, { force });
    if (skipped.length > 0) console.log(`skipped (collected <20h ago): ${skipped.join(", ")}`);

    const runs = due.length > 0 ? await collectSources(db, fetchText, due, limit) : [];
    const collectErrors = printRuns(runs);

    const apiKey = process.env.OPENCODE_GO_API_KEY;
    if (!apiKey) {
      console.error("missing OPENCODE_GO_API_KEY");
      process.exitCode = 1;
      return;
    }
    const { summary, exitCode } = await runScoring(db, {
      profile,
      model: scoringConfig.model,
      endpoint: scoringConfig.endpoint,
      maxDescriptionChars: scoringConfig.maxDescriptionChars,
      apiKey,
      sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
      ...(limit === null ? {} : { limit }),
    });
    const cost =
      (summary.promptTokens / 1_000_000) * scoringConfig.prices.inputPer1M +
      (summary.completionTokens / 1_000_000) * scoringConfig.prices.outputPer1M;
    console.log(
      `scored=${summary.scored} failed=${summary.failed} skipped=${summary.skipped} ` +
        `wall=${(summary.wallMs / 1000).toFixed(1)}s tokens=${summary.promptTokens}+${summary.completionTokens} ` +
        `cost=$${cost.toFixed(4)}${summary.fallbackUsed ? " (json_object fallback used)" : ""}`,
    );
    // Weekly profile proposal; skipped on --limit smoke runs. A failure is printed, never fails the run.
    try {
      if (limit === null && isTuneDue(Date.now())) {
        printResult(
          await generateProposal(db, {
            profile,
            model: scoringConfig.model,
            endpoint: scoringConfig.endpoint,
            maxDescriptionChars: scoringConfig.maxDescriptionChars,
            apiKey,
            sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
          }),
        );
      }
    } catch (e) {
      console.error(`tune failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (collectErrors > 0 || exitCode !== 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
