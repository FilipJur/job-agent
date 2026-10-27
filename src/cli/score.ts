import { parseArgs } from "node:util";
import { openDb } from "../db";
import { loadScoringConfig, secondModel } from "../scoring/config";
import { runScoring, runSecondOpinion } from "../scoring/run";

const { config: scoringConfig, profile } = loadScoringConfig();

async function main(argv: string[]): Promise<void> {
  let limit: number | undefined;
  let second = false;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { limit: { type: "string" }, second: { type: "boolean" } },
      strict: false,
      allowPositionals: true,
    });
    const rawLimit = values.limit as string | undefined;
    if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)) {
      throw new Error(`--limit expects a positive integer, got "${rawLimit}"`);
    }
    limit = rawLimit === undefined ? undefined : Number(rawLimit);
    second = (values.second as boolean | undefined) ?? false;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const secondOnly = second;
  const opinionModel = secondOnly ? secondModel() : undefined;
  if (secondOnly && opinionModel === undefined) {
    console.error("config/scoring.json has no secondModel; second opinion is off");
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
    const print = (kind: string, summary: { scored: number; failed: number; skipped: number; wallMs: number; promptTokens: number; completionTokens: number; fallbackUsed: boolean }) => {
      const cost =
        (summary.promptTokens / 1_000_000) * scoringConfig.prices.inputPer1M +
        (summary.completionTokens / 1_000_000) * scoringConfig.prices.outputPer1M;
      console.log(
        `${kind === "" ? "" : kind + " "}scored=${summary.scored} failed=${summary.failed} skipped=${summary.skipped} ` +
          `wall=${(summary.wallMs / 1000).toFixed(1)}s tokens=${summary.promptTokens}+${summary.completionTokens} ` +
          `cost=$${cost.toFixed(4)}${summary.fallbackUsed ? " (json_object fallback used)" : ""}`,
      );
    };
    if (secondOnly) {
      const { summary, exitCode } = await runSecondOpinion(db, {
        profile,
        model: opinionModel!,
        endpoint: scoringConfig.endpoint,
        maxDescriptionChars: scoringConfig.maxDescriptionChars,
        apiKey,
        sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
        ...(limit === undefined ? {} : { limit }),
      });
      print("second", summary);
      process.exitCode = exitCode;
      return;
    }
    const { summary, exitCode } = await runScoring(db, {
      profile,
      model: scoringConfig.model,
      endpoint: scoringConfig.endpoint,
      maxDescriptionChars: scoringConfig.maxDescriptionChars,
      apiKey,
      sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
      ...(limit === undefined ? {} : { limit }),
    });
    print("", summary);
    process.exitCode = exitCode;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
