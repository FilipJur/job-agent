import type { Database } from "bun:sqlite";
import type {
  AgencyPatch,
  AgencyRow,
  AgencySeed,
  AgencyStatus,
  OfferRow,
  OfferToScore,
  ScoreInput,
  Tab,
  Verdict,
  Workplace,
} from "./types";

/**
 * The only DB access for scoring and the web UI.
 * Scores and feedback are append-only histories; the latest row per offer
 * (by timestamp, then id) is the current one.
 */

interface ListOffersQuery {
  tab: Tab;
  onlyNew?: boolean;
  remote?: boolean;
  olomouc?: boolean;
  includeHidden?: boolean;
}

interface OffersToScoreQuery {
  profileHash: string;
  limit?: number;
}

const FORM_LABELS = "('hpp', 'ico', 'freelance', 'dpp-dpc')";
const NOT_EXCLUDED = "NOT EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label = 'excluded')";
const HPP_COND = `(EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label = 'hpp') OR NOT EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label IN ${FORM_LABELS}))`;
const CONTRACT_COND = "EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label IN ('ico', 'freelance', 'dpp-dpc'))";
const LATEST_SCORE_JOIN = `LEFT JOIN offer_scores s ON s.offer_id = o.id AND NOT EXISTS (
    SELECT 1 FROM offer_scores s2 WHERE s2.offer_id = o.id
      AND (s2.scored_at > s.scored_at OR (s2.scored_at = s.scored_at AND s2.id > s.id)))`;
const LATEST_FEEDBACK_JOIN = `LEFT JOIN feedback f ON f.offer_id = o.id AND NOT EXISTS (
    SELECT 1 FROM feedback f2 WHERE f2.offer_id = o.id
      AND (f2.created_at > f.created_at OR (f2.created_at = f.created_at AND f2.id > f.id)))`;

interface OfferQueryRow {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string | null;
  city: string | null;
  workplace: Workplace;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  published_at: string | null;
  first_seen_at: string;
  partial: number;
  score: number | null;
  reason: string | null;
  gaps: string | null;
  model: string | null;
  scored_at: string | null;
  verdict: Verdict | null;
  feedback_reason: string | null;
  feedback_at: string | null;
}

/** Offers for one UI tab: score desc, unscored last, then newest first. */
export function listOffers(db: Database, q: ListOffersQuery): OfferRow[] {
  const where: string[] = [NOT_EXCLUDED, q.tab === "hpp" ? HPP_COND : CONTRACT_COND];
  if (!q.includeHidden) where.push("(f.id IS NULL OR f.verdict != 'hidden')");
  if (q.onlyNew) where.push("o.first_seen_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day')");
  if (q.remote)
    where.push(
      "(o.workplace = 'remote' OR EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label IN ('remote', 'remote-cz', 'remote-eu')))",
    );
  if (q.olomouc)
    where.push(
      "EXISTS (SELECT 1 FROM offer_labels l WHERE l.offer_id = o.id AND l.label IN ('olomouc', 'okoli-olomouce'))",
    );

  const rows = db
    .query<OfferQueryRow, []>(
      `SELECT o.id, o.source, o.url, o.title, o.company, o.city, o.workplace,
        o.salary_min, o.salary_max, o.currency, o.published_at, o.first_seen_at, o.partial,
        s.score, s.reason, s.gaps, s.model, s.scored_at,
        f.verdict, f.reason AS feedback_reason, f.created_at AS feedback_at
      FROM offers o
      ${LATEST_SCORE_JOIN}
      ${LATEST_FEEDBACK_JOIN}
      WHERE ${where.join(" AND ")}
      ORDER BY (s.score IS NULL), s.score DESC, o.first_seen_at DESC, o.id DESC`,
    )
    .all();
  const labels = labelsByOffer(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    url: r.url,
    title: r.title,
    company: r.company,
    city: r.city,
    workplace: r.workplace,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    currency: r.currency,
    publishedAt: r.published_at,
    firstSeenAt: r.first_seen_at,
    partial: r.partial === 1,
    labels: labels.get(r.id) ?? [],
    score:
      r.score === null
        ? null
        : { score: r.score, reason: r.reason ?? "", gaps: r.gaps ?? "", model: r.model ?? "", scoredAt: r.scored_at ?? "" },
    feedback:
      r.verdict === null ? null : { verdict: r.verdict, reason: r.feedback_reason, createdAt: r.feedback_at ?? "" },
  }));
}

interface ScoreQueryRow {
  id: number;
  title: string;
  company: string | null;
  location_text: string | null;
  city: string | null;
  workplace: Workplace;
  description: string;
}

/** Offers still missing a score for this profile hash; newest first. */
export function offersToScore(db: Database, q: OffersToScoreQuery): OfferToScore[] {
  const rows = db
    .query<ScoreQueryRow, [string, number]>(
      `SELECT o.id, o.title, o.company, o.location_text, o.city, o.workplace, o.description
      FROM offers o
      WHERE ${NOT_EXCLUDED}
        AND NOT EXISTS (SELECT 1 FROM offer_scores s WHERE s.offer_id = o.id AND s.profile_hash = ?)
      ORDER BY o.first_seen_at DESC, o.id DESC
      LIMIT ?`,
    )
    .all(q.profileHash, q.limit ?? -1);
  const labels = labelsByOffer(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    locationText: r.location_text,
    city: r.city,
    workplace: r.workplace,
    description: r.description,
    labels: labels.get(r.id) ?? [],
  }));
}

function labelsByOffer(db: Database, ids: number[]): Map<number, string[]> {
  const byOffer = new Map<number, string[]>();
  if (ids.length === 0) return byOffer;
  const rows = db
    .query<{ offer_id: number; label: string }, []>(
      `SELECT offer_id, label FROM offer_labels WHERE offer_id IN (${ids.join(",")}) ORDER BY label`,
    )
    .all();
  for (const row of rows) {
    const list = byOffer.get(row.offer_id);
    if (list) list.push(row.label);
    else byOffer.set(row.offer_id, [row.label]);
  }
  return byOffer;
}

/** Appends a score; optional new labels are stored with origin 'llm'. */
export function saveScore(db: Database, s: ScoreInput): void {
  const insertScore = db.prepare(
    "INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertLabel = db.prepare("INSERT OR IGNORE INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'llm')");
  db.transaction(() => {
    insertScore.run(s.offerId, s.score, s.reason, s.gaps, s.model, s.profileHash, s.scoredAt);
    for (const label of s.labels ?? []) insertLabel.run(s.offerId, label);
  })();
}

/** Appends a feedback verdict; the latest row per offer is current. */
export function saveFeedback(db: Database, offerId: number, verdict: Verdict, reason?: string): void {
  db.prepare("INSERT INTO feedback (offer_id, verdict, reason, created_at) VALUES (?, ?, ?, ?)").run(
    offerId,
    verdict,
    reason ?? null,
    new Date().toISOString(),
  );
}

interface AgencyDbRow {
  id: number;
  name: string;
  web: string | null;
  city: string | null;
  focus: string | null;
  stack: string | null;
  signal: string | null;
  email: string | null;
  phone: string | null;
  fit: number;
  status: AgencyStatus;
  notes: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

const AGENCY_COLS =
  "id, name, web, city, focus, stack, signal, email, phone, fit, status, notes, last_contact_at, created_at, updated_at";

function toAgencyRow(r: AgencyDbRow): AgencyRow {
  return {
    id: r.id,
    name: r.name,
    web: r.web,
    city: r.city,
    focus: r.focus,
    stack: r.stack,
    signal: r.signal,
    email: r.email,
    phone: r.phone,
    fit: r.fit,
    status: r.status,
    notes: r.notes,
    lastContactAt: r.last_contact_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Agencies ordered by fit desc, then name. */
export function listAgencies(db: Database): AgencyRow[] {
  return db
    .query<AgencyDbRow, []>(`SELECT ${AGENCY_COLS} FROM agencies ORDER BY fit DESC, name ASC`)
    .all()
    .map(toAgencyRow);
}

/** Updates status/notes/lastContactAt and stamps updated_at. */
export function updateAgency(db: Database, id: number, patch: AgencyPatch): AgencyRow {
  const sets: string[] = ["updated_at = ?"];
  const params: (string | null)[] = [new Date().toISOString()];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    params.push(patch.notes);
  }
  if (patch.lastContactAt !== undefined) {
    sets.push("last_contact_at = ?");
    params.push(patch.lastContactAt);
  }
  db.prepare(`UPDATE agencies SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  const row = db.query<AgencyDbRow, [number]>(`SELECT ${AGENCY_COLS} FROM agencies WHERE id = ?`).get(id);
  if (!row) throw new Error(`agency ${id} not found`);
  return toAgencyRow(row);
}

/**
 * Inserts agencies by name; existing names are skipped without touching
 * their status or notes.
 */
export function seedAgencies(db: Database, items: AgencySeed[]): { inserted: number; skipped: number } {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agencies
      (name, web, city, focus, stack, signal, email, phone, fit, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
  );
  const changed = db.query<{ n: number }, []>("SELECT changes() AS n");
  let inserted = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const a of items) {
      insert.run(
        a.name,
        a.web ?? null,
        a.city ?? null,
        a.focus ?? null,
        a.stack ?? null,
        a.signal ?? null,
        a.email ?? null,
        a.phone ?? null,
        a.fit,
        now,
        now,
      );
      if ((changed.get()?.n ?? 0) === 1) inserted += 1;
      else skipped += 1;
    }
  })();
  return { inserted, skipped };
}
