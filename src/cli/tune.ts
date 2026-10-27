import { parseArgs } from "node:util";
import { openDb } from "../db";
import { loadScoringConfig } from "../scoring/config";
import { generateProposal, type GenerateResult } from "../tune/generate";
import type { EvalSummary } from "../tune/proposals";

const num = (x: number | null): string => (x === null ? "–" : x.toFixed(2));

function printComparison(current: EvalSummary, proposed: EvalSummary): void {
  const rows: [string, (m: EvalSummary) => string][] = [
    ["n (+/−)", (m) => `${m.n} (${m.positives}/${m.negatives})`],
    ["AUC", (m) => num(m.auc)],
    ["P@5", (m) => num(m.precisionAt5)],
    ["P@10", (m) => num(m.precisionAt10)],
    ["mean score +", (m) => num(m.meanPositive)],
    ["mean score −", (m) => num(m.meanNegative)],
  ];
  const table = [["", "current", "proposed"], ...rows.map(([name, cell]) => [name, cell(current), cell(proposed)])];
  const widths = table[0]!.map((_, i) => Math.max(...table.map((r) => r[i]!.length)));
  for (const r of table) console.log(r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd());
}

/** Prints the outcome of `generateProposal`; shared with the daily run. */
export function printResult(result: GenerateResult): void {
  if (result.kind !== "created") {
    console.log(`tune: ${result.message}`);
    return;
  }
  printComparison(result.proposal.metrics.current, result.proposal.metrics.proposed);
  const evaluation = result.proposal.evaluation;
  console.log(
    evaluation?.kind === "holdout"
      ? `měřeno na odložených ${evaluation.n} štítcích`
      : "měřeno na stejných štítcích (málo dat, odhad je optimistický)",
  );
  console.log(`tune: proposal ${result.proposal.id} is ${result.proposal.status}; wrote ${result.path}`);
}

async function main(argv: string[]): Promise<void> {
  let minLabels: number | undefined;
  try {
    const { values } = parseArgs({ args: argv, options: { "min-labels": { type: "string" } }, strict: true });
    const raw = values["min-labels"];
    if (raw !== undefined && (!/^\d+$/.test(raw) || Number(raw) < 1)) {
      throw new Error(`--min-labels expects a positive integer, got "${raw}"`);
    }
    minLabels = raw === undefined ? undefined : Number(raw);
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
  const { config, profile } = loadScoringConfig();
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const started = Date.now();
    const result = await generateProposal(db, {
      profile,
      model: config.model,
      endpoint: config.endpoint,
      maxDescriptionChars: config.maxDescriptionChars,
      apiKey,
      sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
      ...(minLabels === undefined ? {} : { minLabels }),
    });
    printResult(result);
    console.log(`tune: model=${config.model} wall=${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`tune failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
