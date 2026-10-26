import type { Database, SQLQueryBindings } from "bun:sqlite";
import { normalize } from "./normalize";
import type { Collector, Offer } from "./types";

export interface RunSummary {
  source: string;
  status: "ok" | "error";
  fetched: number;
  new: number;
  error: string | null;
}

/** Runs collectors one after another; a failing collector is recorded and the run continues. */
export async function runCollectors(
  db: Database,
  collectors: Collector[],
  now: () => Date = () => new Date(),
): Promise<RunSummary[]> {
  const insertRun = db.prepare<{ id: number }, [string, string]>(
    "INSERT INTO runs (source, started_at) VALUES (?, ?) RETURNING id",
  );
  const finishRun = db.prepare("UPDATE runs SET finished_at = ?, status = ?, fetched = ?, new = ?, error = ? WHERE id = ?");
  const findBySourceId = db.prepare<{ id: number }, [string, string]>(
    "SELECT id FROM offers WHERE source = ? AND source_id = ?",
  );
  const findByDedupKey = db.prepare<{ id: number }, [string]>("SELECT id FROM offers WHERE dedup_key = ? LIMIT 1");
  const touch = db.prepare("UPDATE offers SET last_seen_at = ? WHERE id = ?");
  const insertOffer = db.prepare<{ id: number }, SQLQueryBindings[]>(
    `INSERT INTO offers (source, source_id, url, title, company, location_text, city, workplace,
       salary_min, salary_max, currency, published_at, description, dedup_key, first_seen_at, last_seen_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertLabel = db.prepare("INSERT OR IGNORE INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'rule')");

  /** Returns true when a new offer row was inserted. */
  const store = (offer: Offer, at: string): boolean => {
    const same = findBySourceId.get(offer.source, offer.sourceId);
    if (same) {
      touch.run(at, same.id);
      return false;
    }
    const repost = offer.title !== "" ? findByDedupKey.get(offer.dedupKey) : null;
    if (repost) {
      touch.run(at, repost.id);
      return false;
    }
    const row = insertOffer.get(
      offer.source,
      offer.sourceId,
      offer.url,
      offer.title,
      offer.company,
      offer.locationText,
      offer.city,
      offer.workplace,
      offer.salaryMin,
      offer.salaryMax,
      offer.currency,
      offer.publishedAt,
      offer.description,
      offer.dedupKey,
      at,
      at,
      offer.rawJson,
    );
    for (const label of offer.labels) insertLabel.run(row!.id, label);
    return true;
  };
  const storeBatch = db.transaction((offers: Offer[], at: string) => {
    let inserted = 0;
    for (const offer of offers) if (store(offer, at)) inserted++;
    return inserted;
  });

  const summaries: RunSummary[] = [];
  for (const collector of collectors) {
    const runId = insertRun.get(collector.name, now().toISOString())!.id;
    const summary: RunSummary = { source: collector.name, status: "ok", fetched: 0, new: 0, error: null };
    try {
      const raw = await collector.collect();
      summary.fetched = raw.length;
      const offers = raw.map((r) => normalize(r));
      summary.new = storeBatch(offers, now().toISOString());
    } catch (err) {
      summary.status = "error";
      summary.error = err instanceof Error ? err.message : String(err);
    }
    finishRun.run(now().toISOString(), summary.status, summary.fetched, summary.new, summary.error, runId);
    summaries.push(summary);
  }
  return summaries;
}
