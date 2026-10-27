import { parseArgs } from "node:util";
import { openDb } from "../db";
import { runDigest } from "../digest/run";

async function main(argv: string[]): Promise<void> {
  let dryRun: boolean;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { "dry-run": { type: "boolean", default: false } },
      strict: true,
    });
    dryRun = values["dry-run"] ?? false;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }
  const db = openDb(process.env.DB_PATH || "data/jobs.db");
  try {
    const result = await runDigest({ db, dryRun });
    console.log(dryRun ? result.markdown : `digest: ${result.short}`);
  } catch (e) {
    console.error(`digest failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
if (import.meta.main) await main(process.argv.slice(2));
