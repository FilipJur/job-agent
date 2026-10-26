import { parseArgs } from "node:util";
import { openDb } from "../db";
import { loadScoringConfig } from "../scoring/config";
import { runScoring } from "../scoring/run";

const { config: scoringConfig, profile } = loadScoringConfig();

async function main(argv: string[]): Promise<void> {
  let limit: number | undefined;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { limit: { type: "string" } },
      strict: false,
      allowPositionals: true,
    });
    const rawLimit = values.limit as string | undefined;
    if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)) {
      throw new Error(`--limit expects a positive integer, got "${rawLimit}"`);
    }
    limit = rawLimit === undefined ? undefined : Number(rawLimit);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) {
    console.error("missing OPENCODE_GO_API_KEY");
    process.exitCode = 1;
    return;
  }

  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const { summary, exitCode } = await runScoring(db, {
      profile,
      model: scoringConfig.model,
      endpoint: scoringConfig.endpoint,
      maxDescriptionChars: scoringConfig.maxDescriptionChars,
      apiKey,
      sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
      ...(limit === undefined ? {} : { limit }),
    });
    const cost =
      (summary.promptTokens / 1_000_000) * scoringConfig.prices.inputPer1M +
      (summary.completionTokens / 1_000_000) * scoringConfig.prices.outputPer1M;
    console.log(
      `scored=${summary.scored} failed=${summary.failed} skipped=${summary.skipped} ` +
        `wall=${(summary.wallMs / 1000).toFixed(1)}s tokens=${summary.promptTokens}+${summary.completionTokens} ` +
        `cost=$${cost.toFixed(4)}${summary.fallbackUsed ? " (json_object fallback used)" : ""}`,
    );
    process.exitCode = exitCode;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
