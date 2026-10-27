import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../db";
import { labeledOffers, type LabeledOffer } from "../eval/labels";
import { computeMetrics, type EvalMetrics } from "../eval/metrics";
import { replayLabeled, type ReplayResult } from "../eval/replay";
import { profilePath } from "../profile";
import { loadScoringConfig } from "../scoring/config";
import { profileHashOf } from "../scoring/run";

const MIN_PER_CLASS = 2;

const num = (x: number | null): string => (x === null ? "–" : x.toFixed(2));

function printTable(columns: { name: string; metrics: EvalMetrics }[]): void {
  const row = (name: string, cell: (m: EvalMetrics) => string): string[] => [name, ...columns.map((c) => cell(c.metrics))];
  const matrix = (v: "fit" | "blocked" | "aspiration") => (m: EvalMetrics) =>
    `${m.verdictMatrix[v].positive}/${m.verdictMatrix[v].negative}/${m.verdictMatrix[v].aspiration}`;
  const rows = [
    ["", ...columns.map((c) => c.name)],
    row("n (+/−/asp)", (m) => `${m.n} (${m.positives}/${m.negatives}/${m.aspirations})`),
    row("unscored", (m) => String(m.unscored)),
    row("AUC", (m) => num(m.auc)),
    row("mean score +", (m) => num(m.meanScore.positive)),
    row("mean score −", (m) => num(m.meanScore.negative)),
    row("mean score asp", (m) => num(m.meanScore.aspiration)),
    row("P@5", (m) => num(m.precisionAt[5])),
    row("P@10", (m) => num(m.precisionAt[10])),
    row("model fit → +/−/asp", matrix("fit")),
    row("model blocked → +/−/asp", matrix("blocked")),
    row("model aspiration → +/−/asp", matrix("aspiration")),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) console.log(r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd());
}

function printDisagreements(name: string, metrics: EvalMetrics, offers: LabeledOffer[]): void {
  console.log(`\ntop disagreements (${name}):`);
  if (metrics.disagreements.length === 0) console.log("  none");
  const byId = new Map(offers.map((o) => [o.offerId, o]));
  for (const d of metrics.disagreements) {
    const o = byId.get(d.offerId);
    const title = o ? `${o.title}${o.company ? ` — ${o.company}` : ""}` : "";
    console.log(`  #${d.offerId}  ${d.label.padEnd(8)}  score ${d.score.toFixed(1).padStart(4)}  severity ${d.severity.toFixed(1)}  ${title}`);
  }
}

function writeResult(kind: "stored" | "replay", payload: Record<string, unknown>): string {
  const createdAt = new Date().toISOString();
  const dir = process.env.EVAL_DIR || "data/eval";
  mkdirSync(dir, { recursive: true });
  // ISO 8601 basic format: no colons in file names.
  const path = join(dir, `${createdAt.replace(/[-:]/g, "").replace(/\.\d+/, "")}-${kind}.json`);
  writeFileSync(path, JSON.stringify({ kind, createdAt, ...payload }, null, 2) + "\n");
  return path;
}

async function main(argv: string[]): Promise<void> {
  let values: { replay?: boolean; profile?: string; model?: string };
  try {
    values = parseArgs({
      args: argv,
      options: { replay: { type: "boolean" }, profile: { type: "string" }, model: { type: "string" } },
      strict: true,
    }).values;
    if (!values.replay && (values.profile !== undefined || values.model !== undefined)) {
      throw new Error("--profile and --model only apply with --replay");
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const offers = labeledOffers(db);
    const stored = computeMetrics(
      offers.map((o) => ({ offerId: o.offerId, label: o.label, score: o.latestScore?.score ?? null, verdict: o.latestScore?.verdict ?? null })),
    );
    const opinionItems = offers.map((o) => ({
      offerId: o.offerId,
      label: o.label,
      score: o.latestOpinion?.score ?? null,
      verdict: o.latestOpinion?.verdict ?? null,
    }));
    const opinionScored = opinionItems.filter((i) => i.score !== null);
    const opinion = opinionScored.length > 0 ? computeMetrics(opinionItems) : null;
    const withOpinion = (cols: { name: string; metrics: EvalMetrics }[]) =>
      opinion === null ? cols : [...cols, { name: "opinion", metrics: opinion }];
    const printRecommendation = (): void => {
      if (opinion === null || stored.auc === null || opinion.auc === null || stored.n < 10) {
        console.log("\nmálo štítků pro doporučení");
        return;
      }
      if (stored.auc === opinion.auc) {
        console.log("\nmálo štítků pro doporučení");
        return;
      }
      const better = opinion.auc > stored.auc ? "opinion" : "stored";
      console.log(`\ndoporučení: vyšší AUC má ${better} (${num(stored.auc)} vs ${num(opinion.auc)})`);
    };
    if (stored.positives < MIN_PER_CLASS || stored.negatives < MIN_PER_CLASS) {
      console.log(
        `notice: ${stored.positives} positive and ${stored.negatives} negative labels; ` +
          `AUC needs at least ${MIN_PER_CLASS} of each to mean anything. Label more offers in Triáž.\n`,
      );
    }

    if (!values.replay) {
      printTable(withOpinion([{ name: "stored", metrics: stored }]));
      printDisagreements("stored", stored, offers);
      if (opinion !== null) printDisagreements("opinion", opinion, offers);
      printRecommendation();
      console.log(`\nwrote ${writeResult("stored", { offers, metrics: stored, opinion: opinion === null ? null : { metrics: opinion, n: opinionScored.length } })}`);
      return;
    }

    const apiKey = process.env.OPENCODE_GO_API_KEY;
    if (!apiKey) {
      console.error("missing OPENCODE_GO_API_KEY");
      process.exitCode = 1;
      return;
    }
    const { config, profile: liveProfile } = loadScoringConfig();
    const usedProfilePath = values.profile ?? profilePath();
    const profile = values.profile === undefined ? liveProfile : readFileSync(values.profile, "utf8");
    if (profile.trim() === "") {
      console.error(`profile ${usedProfilePath} is empty`);
      process.exitCode = 1;
      return;
    }
    const model = values.model ?? config.model;
    const started = Date.now();
    const replay: ReplayResult = await replayLabeled(db, {
      profile,
      model,
      endpoint: config.endpoint,
      maxDescriptionChars: config.maxDescriptionChars,
      apiKey,
      sessionId: process.env.OPENCODE_GO_SESSION ?? crypto.randomUUID(),
    });
    for (const f of replay.failed) console.error(`replay failed for offer ${f.offerId}: ${f.error}`);
    console.log(
      `replay model=${model} profile=${usedProfilePath} scored=${replay.items.length} failed=${replay.failed.length} ` +
        `tokens=${replay.promptTokens}+${replay.completionTokens} wall=${((Date.now() - started) / 1000).toFixed(1)}s\n`,
    );
    printTable(
      withOpinion([
        { name: "stored", metrics: stored },
        { name: "replay", metrics: replay.metrics },
      ]),
    );
    printDisagreements("stored", stored, offers);
    printDisagreements("replay", replay.metrics, offers);
    if (opinion !== null) printDisagreements("opinion", opinion, offers);
    printRecommendation();
    const path = writeResult("replay", {
      model,
      profilePath: usedProfilePath,
      profileHash: profileHashOf(profile, model),
      stored: { offers, metrics: stored },
      opinion: opinion === null ? null : { metrics: opinion, n: opinionScored.length },
      replay,
    });
    console.log(`\nwrote ${path}`);
    if (offers.length > 0 && replay.failed.length === offers.length) process.exitCode = 1;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
