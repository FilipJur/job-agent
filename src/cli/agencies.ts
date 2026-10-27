import { readAgencySeeds } from "../agencies/seeds";
import { openDb } from "../db";
import { seedAgencies } from "../repo";

const db = openDb(process.env.DB_PATH || "data/jobs.db");
try {
  const { inserted, updated, skipped } = seedAgencies(db, readAgencySeeds());
  console.log(`agencies: inserted ${inserted}, updated ${updated}, skipped ${skipped}`);
} finally {
  db.close();
}
