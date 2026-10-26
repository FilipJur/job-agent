import { openDb } from "../db";
import { seedAgencies } from "../repo";
import type { AgencySeed } from "../types";
import seed from "../../config/agencies.json";

const db = openDb(process.env.DB_PATH || "data/jobs.db");
try {
  const items: AgencySeed[] = seed;
  const { inserted, skipped } = seedAgencies(db, items);
  console.log(`agencies: inserted ${inserted}, skipped ${skipped}`);
} finally {
  db.close();
}
