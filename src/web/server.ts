import type { Database } from "bun:sqlite";
import { join, resolve, sep } from "node:path";
import { openDb } from "../db";
import { marketReport } from "../market/report";
import { readProfile, writeProfile } from "../profile";
import { countOffersToScore, listAgencies, listAspirations, listOffers, saveFeedback, triageQueue, updateAgency } from "../repo";
import { profileHashOf } from "../scoring/run";
import { scoreModel } from "../scoring/config";
import { applyProposal, listProposals, rejectProposal } from "../tune/proposals";
import type { AgencyPatch, AgencyStatus } from "../types";

/** Paths and values are fixed by the API contract in docs; keep them in one place. */
const DIST = resolve(import.meta.dir, "../../web/dist");
const TABS = ["hpp", "kontrakty"] as const;
const VERDICTS = ["up", "down", "responded", "hidden", "aspiration"] as const;
const STATUSES = ["new", "contacted", "replied", "meeting", "work", "declined"] as const;
const AGENCY_FIELDS = ["status", "notes", "lastContactAt"] as const;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, error: string): Response => json({ error }, status);
const plain = (status: number, text: string): Response =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const parseId = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
};

const flag = (params: URLSearchParams, name: string): boolean => params.get(name) === "1";

type Body = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

/** POST/PATCH payloads must be JSON objects; arrays, scalars and broken JSON are 400. */
async function readObject(req: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await req.text());
  } catch {
    return { ok: false, response: fail(400, "body must be valid JSON") };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: fail(400, "body must be a JSON object") };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

function offers(db: Database, url: URL): Response {
  const tab = url.searchParams.get("tab");
  if (tab === null) return fail(400, `tab is required (${TABS.join(" or ")})`);
  if (!isOneOf(TABS, tab)) return fail(400, `tab must be one of ${TABS.join(", ")}`);
  return json(
    listOffers(db, {
      tab,
      onlyNew: flag(url.searchParams, "new"),
      remote: flag(url.searchParams, "remote"),
      olomouc: flag(url.searchParams, "olomouc"),
      includeHidden: flag(url.searchParams, "hidden"),
    }),
  );
}

function triage(db: Database, url: URL): Response {
  const raw = url.searchParams.get("limit");
  if (raw !== null) {
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, "limit must be an integer between 1 and 100");
    return json(triageQueue(db, { limit }));
  }
  return json(triageQueue(db, { limit: 20 }));
}

/** POST appends a verdict and acknowledges it. */
async function postFeedback(req: Request, db: Database, id: number): Promise<Response> {
  const parsed = await readObject(req);
  if (!parsed.ok) return parsed.response;
  const { verdict, reason } = parsed.body;
  if (!isOneOf(VERDICTS, verdict)) return fail(400, `verdict must be one of ${VERDICTS.join(", ")}`);
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return fail(400, "reason must be a string");
  }
  try {
    // saveFeedback does not check existence; the foreign key is what reports an unknown offer.
    saveFeedback(db, id, verdict, typeof reason === "string" ? reason : undefined);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return fail(404, `offer ${id} not found`);
    }
    throw error;
  }
  return json({ ok: true });
}

/** DELETE clears the verdict (appends `cleared`). */
function deleteFeedback(db: Database, id: number): Response {
  const exists = db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM offers WHERE id = ?").get(id);
  if (exists?.n !== 1) return fail(404, `offer ${id} not found`);
  saveFeedback(db, id, "cleared");
  return json({ ok: true });
}

async function patchAgency(req: Request, db: Database, id: number): Promise<Response> {
  const agency = listAgencies(db).find((row) => row.id === id);
  if (!agency) return fail(404, `agency ${id} not found`);
  const parsed = await readObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const unknown = Object.keys(body).filter((key) => !(AGENCY_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) return fail(400, `unknown fields: ${unknown.join(", ")}`);
  const patch: AgencyPatch = {};
  if ("status" in body) {
    if (!isOneOf<AgencyStatus>(STATUSES, body.status)) {
      return fail(400, `status must be one of ${STATUSES.join(", ")}`);
    }
    patch.status = body.status;
  }
  for (const key of ["notes", "lastContactAt"] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value !== null && typeof value !== "string") return fail(400, `${key} must be a string or null`);
    patch[key] = value;
  }
  // An empty patch changes nothing, so do not bump updated_at for it.
  return json(Object.keys(patch).length === 0 ? agency : updateAgency(db, id, patch));
}

function profileStatus(db: Database): Response {
  const text = readProfile();
  return json({ text, pending: countOffersToScore(db, profileHashOf(text, scoreModel())) });
}

async function putProfile(req: Request, db: Database): Promise<Response> {
  const parsed = await readObject(req);
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.body.text !== "string") return fail(400, "text must be a string");
  // An empty profile would re-score every offer against nothing.
  if (parsed.body.text.trim() === "") return fail(400, "text must not be empty");
  writeProfile(parsed.body.text);
  return profileStatus(db);
}

const UI_MISSING = "web UI is not built: run `bun run web:build`";

/** Serves `web/dist`, falling back to index.html for app routes; the API keeps working without a build. */
async function serveStatic(pathname: string): Promise<Response> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return plain(400, "malformed path");
  }
  if (rel.includes("\0")) return plain(400, "malformed path");
  const target = resolve(DIST, rel);
  if (target !== DIST && !target.startsWith(DIST + sep)) return plain(404, "not found");
  if (rel !== "") {
    const file = Bun.file(target);
    if (await file.exists()) {
      return new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } });
    }
  }
  if (!rel.includes(".")) {
    const index = Bun.file(join(DIST, "index.html"));
    if (await index.exists()) return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
    return plain(404, UI_MISSING);
  }
  return plain(404, "not found");
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    return new URL(raw, "http://127.0.0.1");
  }
}

async function route(req: Request, db: Database): Promise<Response> {
  const url = parseUrl(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/api/offers") {
    return method === "GET" || method === "HEAD" ? offers(db, url) : fail(405, "use GET");
  }
  if (path === "/api/triage") {
    return method === "GET" || method === "HEAD" ? triage(db, url) : fail(405, "use GET");
  }
  if (path === "/api/aspirations") {
    return method === "GET" || method === "HEAD" ? json(listAspirations(db)) : fail(405, "use GET");
  }
  const feedback = /^\/api\/offers\/([^/]+)\/feedback$/.exec(path);
  if (feedback) {
    const id = parseId(feedback[1] ?? "");
    if (id === null) return fail(400, "offer id must be an integer");
    if (method === "POST") return postFeedback(req, db, id);
    if (method === "DELETE") return deleteFeedback(db, id);
    return fail(405, "use POST or DELETE");
  }
  if (path === "/api/market") {
    return method === "GET" || method === "HEAD" ? json(marketReport(db)) : fail(405, "use GET");
  }
  if (path === "/api/agencies") {
    return method === "GET" || method === "HEAD" ? json(listAgencies(db)) : fail(405, "use GET");
  }
  if (path === "/api/profile") {
    if (method === "GET" || method === "HEAD") return profileStatus(db);
    if (method === "PUT") return putProfile(req, db);
    return fail(405, "use GET or PUT");
  }
  if (path === "/api/proposals") {
    return method === "GET" || method === "HEAD" ? json(listProposals()) : fail(405, "use GET");
  }
  const proposal = /^\/api\/proposals\/([^/]+)\/(apply|reject)$/.exec(path);
  if (proposal) {
    if (method !== "POST") return fail(405, "use POST");
    const id = proposal[1] ?? "";
    const result = proposal[2] === "apply" ? applyProposal(id) : rejectProposal(id);
    return result.ok ? json({ ok: true }) : fail(result.status, result.error);
  }
  const agency = /^\/api\/agencies\/([^/]+)$/.exec(path);
  if (agency) {
    const id = parseId(agency[1] ?? "");
    if (id === null) return fail(400, "agency id must be an integer");
    return method === "PATCH" ? patchAgency(req, db, id) : fail(405, "use PATCH");
  }
  if (path === "/api" || path.startsWith("/api/")) return fail(404, `unknown endpoint ${path}`);
  if (method !== "GET" && method !== "HEAD") return plain(405, "method not allowed");
  return serveStatic(path);
}

/** API + static app; exported so tests can call it without opening a socket. */
export async function handle(req: Request, db: Database): Promise<Response> {
  try {
    return await route(req, db);
  } catch (error) {
    console.error("web: request failed", error);
    return fail(500, error instanceof Error ? error.message : "internal error");
  }
}

if (import.meta.main) {
  const dbPath = process.env.DB_PATH ?? "data/jobs.db";
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${process.env.PORT}`);
  }
  const db = openDb(dbPath);
  const server = Bun.serve({ port, hostname: process.env.HOST ?? "127.0.0.1", fetch: (req) => handle(req, db) });
  console.log(`job-agent web on http://${server.hostname}:${server.port} (db: ${dbPath})`);
}
