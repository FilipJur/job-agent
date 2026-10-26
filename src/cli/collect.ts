import { createJobsCzCollector } from "../collectors/jobscz";
import { openDb } from "../db";
import { runCollectors } from "../pipeline";

const db = openDb(process.env.DB_PATH || "data/jobs.db");
try {
  const runs = await runCollectors(db, [createJobsCzCollector()]);
  let fetched = 0;
  let added = 0;
  let errors = 0;
  for (const r of runs) {
    const failed = r.status === "error" ? 1 : 0;
    fetched += r.fetched;
    added += r.new;
    errors += failed;
    const line = `${r.source}: ${r.status === "ok" ? "ok" : "ERROR"} fetched=${r.fetched} new=${r.new} errors=${failed}`;
    console.log(r.status === "ok" ? line : `${line} — ${r.error}`);
  }
  console.log(`total: fetched=${fetched} new=${added} errors=${errors}`);
  if (errors > 0) process.exitCode = 1;
} finally {
  db.close();
}
