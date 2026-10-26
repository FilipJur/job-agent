import type { Database, SQLQueryBindings } from "bun:sqlite";
import { normalize } from "./normalize";
import type { Collector, Offer, RawOffer } from "./types";

export interface RunSummary {
  source: string;
  status: "ok" | "error";
  fetched: number;
  new: number;
  updated: number;
  partial: number;
  detailErrors: number;
  error: string | null;
}

/** True when a collector payload records a per-offer detail failure in `detailError` (non-empty string). */
function hasDetailError(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("detailError" in raw)) return false;
  const err = raw.detailError;
  return typeof err === "string" && err.length > 0;
}

/** Same check over a stored `raw_json` string; corrupt rows count as "no detail error". */
function storedDetailError(rawJson: string): boolean {
  try {
    return hasDetailError(JSON.parse(rawJson));
  } catch {
    return false;
  }
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
  const finishRun = db.prepare(
    "UPDATE runs SET finished_at = ?, status = ?, fetched = ?, new = ?, error = ?, partial = ?, detail_errors = ? WHERE id = ?",
  );
  const findBySourceId = db.prepare<{ id: number; raw_json: string }, [string, string]>(
    "SELECT id, raw_json FROM offers WHERE source = ? AND source_id = ?",
  );
  const findByDedupKey = db.prepare<{ id: number }, [string]>("SELECT id FROM offers WHERE dedup_key = ? LIMIT 1");
  const touch = db.prepare("UPDATE offers SET last_seen_at = ? WHERE id = ?");
  const updateOffer = db.prepare(
    `UPDATE offers SET description = ?, location_text = ?, city = ?, salary_min = ?, salary_max = ?,
       currency = ?, published_at = ?, partial = ?, raw_json = ?, last_seen_at = ? WHERE id = ?`,
  );
  const clearRuleLabels = db.prepare("DELETE FROM offer_labels WHERE offer_id = ? AND origin = 'rule'");
  const insertOffer = db.prepare<{ id: number }, SQLQueryBindings[]>(
    `INSERT INTO offers (source, source_id, url, title, company, location_text, city, workplace,
       salary_min, salary_max, currency, published_at, description, dedup_key, first_seen_at, last_seen_at, raw_json, partial)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertLabel = db.prepare("INSERT OR IGNORE INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'rule')");

  /** Stores one offer: `"inserted"` for a new row, `"updated"` when a stored detail failure is replaced in place, null for an already-known offer. */
  const store = (raw: RawOffer, offer: Offer, at: string): "inserted" | "updated" | null => {
    const same = findBySourceId.get(offer.source, offer.sourceId);
    if (same) {
      // Retry: the stored row only has a card + detail failure, the incoming one has the detail now.
      if (!hasDetailError(raw) && storedDetailError(same.raw_json)) {
        updateOffer.run(
          offer.description,
          offer.locationText,
          offer.city,
          offer.salaryMin,
          offer.salaryMax,
          offer.currency,
          offer.publishedAt,
          offer.partial ? 1 : 0,
          offer.rawJson,
          at,
          same.id,
        );
        clearRuleLabels.run(same.id);
        for (const label of offer.labels) insertLabel.run(same.id, label);
        return "updated";
      }
      touch.run(at, same.id);
      return null;
    }
    // Company is required: without it the dedup key is title|city only and merges unrelated offers.
    const repost = offer.title !== "" && offer.company?.trim() ? findByDedupKey.get(offer.dedupKey) : null;
    if (repost) {
      touch.run(at, repost.id);
      return null;
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
      offer.partial ? 1 : 0,
    );
    for (const label of offer.labels) insertLabel.run(row!.id, label);
    return "inserted";
  };
  /** Stores a batch; returns the raw offers that produced a new row plus the count of in-place detail updates. */
  const storeBatch = db.transaction((pairs: { raw: RawOffer; offer: Offer }[], at: string) => {
    const inserted: RawOffer[] = [];
    let updated = 0;
    for (const p of pairs) {
      const result = store(p.raw, p.offer, at);
      if (result === "inserted") inserted.push(p.raw);
      else if (result === "updated") updated++;
    }
    return { inserted, updated };
  });

  const summaries: RunSummary[] = [];
  for (const collector of collectors) {
    const runId = insertRun.get(collector.name, now().toISOString())!.id;
    const summary: RunSummary = {
      source: collector.name,
      status: "ok",
      fetched: 0,
      new: 0,
      updated: 0,
      partial: 0,
      detailErrors: 0,
      error: null,
    };
    try {
      const raw = await collector.collect();
      summary.fetched = raw.length;
      const offers = raw.map((r) => normalize(r));
      const stored = storeBatch(
        raw.map((r, i) => ({ raw: r, offer: offers[i]! })),
        now().toISOString(),
      );
      summary.new = stored.inserted.length;
      summary.updated = stored.updated;
      summary.partial = stored.inserted.filter((r) => r.partial === true).length;
      summary.detailErrors = stored.inserted.filter((r) => hasDetailError(r.raw)).length;
    } catch (err) {
      summary.status = "error";
      summary.error = err instanceof Error ? err.message : String(err);
    }
    finishRun.run(
      now().toISOString(),
      summary.status,
      summary.fetched,
      summary.new,
      summary.error,
      summary.partial,
      summary.detailErrors,
      runId,
    );
    summaries.push(summary);
  }
  return summaries;
}
