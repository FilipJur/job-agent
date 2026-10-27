import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { listAgencies, seedAgencies } from "../src/repo";
import { scoreModel } from "../src/scoring/config";
import { profileHashOf } from "../src/scoring/run";
import { handle } from "../src/web/server";

let db: Database;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  seq = 0;
});

afterEach(() => {
  db.close();
});

function offer(labels: string[], workplace = "unknown"): number {
  seq += 1;
  const row = db
    .query<{ id: number }, [string, string, string]>(
      `INSERT INTO offers (source, source_id, url, title, workplace, description, dedup_key, first_seen_at, last_seen_at, raw_json)
       VALUES ('t', ?, 'https://example.com/', ?, ?, '', 'k', '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '{}')
       RETURNING id`,
    )
    .get(`s${seq}`, `Offer ${seq}`, workplace) as { id: number };
  for (const label of labels) db.run("INSERT INTO offer_labels (offer_id, label, origin) VALUES (?, ?, 'rule')", [row.id, label]);
  return row.id;
}

function agencyId(name = "Acme"): number {
  seedAgencies(db, [{ name, web: null, city: "Olomouc", focus: null, stack: null, signal: null, email: null, phone: null, fit: 7 }]);
  const row = listAgencies(db).find((a) => a.name === name);
  if (!row) throw new Error("seeded agency not found");
  return row.id;
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await handle(new Request(`http://localhost${path}`, init), db);
  return { status: res.status, body: await res.json() };
}

const send = (method: string, path: string, body: unknown): Promise<{ status: number; body: any }> =>
  call(path, { method, body: typeof body === "string" ? body : JSON.stringify(body) });

const ids = (rows: { id: number }[]): number[] => rows.map((r) => r.id);

describe("offers API", () => {
  test("routes tabs and applies the remote filter", async () => {
    const hpp = offer(["hpp", "remote"], "remote");
    const ico = offer(["ico"], "onsite");

    expect(ids((await call("/api/offers?tab=hpp")).body)).toEqual([hpp]);
    expect(ids((await call("/api/offers?tab=kontrakty")).body)).toEqual([ico]);
    expect(ids((await call("/api/offers?tab=hpp&remote=1")).body)).toEqual([hpp]);
    expect((await call("/api/offers?tab=kontrakty&remote=1")).body).toHaveLength(0);
    expect((await call("/api/offers")).status).toBe(400);
    expect((await call("/api/offers?tab=other")).status).toBe(400);
  });

  test("feedback POST is visible on the next GET", async () => {
    const id = offer(["hpp"]);
    expect((await send("POST", `/api/offers/${id}/feedback`, { verdict: "up", reason: "good fit" })).status).toBe(200);
    const [row] = (await call("/api/offers?tab=hpp")).body;
    expect(row.feedback).toMatchObject({ verdict: "up", reason: "good fit" });
  });

  test("hidden offer leaves the default list but stays with hidden=1", async () => {
    const id = offer(["hpp"]);
    expect((await send("POST", `/api/offers/${id}/feedback`, { verdict: "hidden" })).status).toBe(200);
    expect((await call("/api/offers?tab=hpp")).body).toHaveLength(0);
    expect(ids((await call("/api/offers?tab=hpp&hidden=1")).body)).toEqual([id]);
  });

  test("feedback DELETE clears the verdict; aspiration POST moves the offer to /api/aspirations", async () => {
    const id = offer(["hpp"]);
    await send("POST", `/api/offers/${id}/feedback`, { verdict: "responded" });
    expect((await call(`/api/offers/${id}/feedback`, { method: "DELETE" })).status).toBe(200);
    expect((await call("/api/offers?tab=hpp")).body[0].feedback).toBeNull();
    expect((await call("/api/offers/9999/feedback", { method: "DELETE" })).status).toBe(404);

    await send("POST", `/api/offers/${id}/feedback`, { verdict: "aspiration" });
    expect((await call("/api/offers?tab=hpp")).body).toHaveLength(0);
    expect((await call("/api/aspirations")).body).toMatchObject([{ id, source: "user" }]);
  });

  test("rejects bad verdicts, ids and bodies with 400", async () => {
    const id = offer(["hpp"]);
    expect((await send("POST", `/api/offers/${id}/feedback`, { verdict: "maybe" })).status).toBe(400);
    expect((await send("POST", `/api/offers/${id}/feedback`, {})).status).toBe(400);
    expect((await send("POST", `/api/offers/${id}/feedback`, "null")).status).toBe(400);
    expect((await send("POST", `/api/offers/${id}/feedback`, "not json")).status).toBe(400);
    expect((await send("POST", "/api/offers/abc/feedback", { verdict: "up" })).status).toBe(400);
    expect((await send("PATCH", `/api/agencies/${agencyId()}`, { status: "bogus" })).status).toBe(400);
    expect((await send("PATCH", `/api/agencies/${agencyId("Other")}`, { name: "x" })).status).toBe(400);
  });

  test("unknown ids and endpoints are 404", async () => {
    expect((await send("POST", "/api/offers/9999/feedback", { verdict: "up" })).status).toBe(404);
    expect((await send("PATCH", "/api/agencies/9999", { status: "contacted" })).status).toBe(404);
    expect((await call("/api/nope")).status).toBe(404);
    expect((await send("PATCH", "/api/agencies/nope", { status: "contacted" })).status).toBe(400);
  });

  test("static misses and escaping paths are plain 404", async () => {
    // Note: %2e is dot-normalized by the URL parser before handle() sees it,
    // so traversal uses %2f which survives parsing and reaches the guard.
    for (const path of ["/missing.js", "/..%2f..%2fetc%2fpasswd"]) {
      const res = await handle(new Request(`http://localhost${path}`), db);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/plain");
    }
  });
});

describe("agencies API", () => {
  test("PATCH persists status, notes and lastContactAt", async () => {
    const id = agencyId();
    const patch = { status: "contacted", notes: "sent rate", lastContactAt: "2026-10-26T12:00:00.000Z" };
    const res = await send("PATCH", `/api/agencies/${id}`, patch);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, ...patch });

    const [listed] = (await call("/api/agencies")).body;
    expect(listed).toMatchObject({ id, ...patch, createdAt: expect.any(String) });
  });
});

describe("profile API", () => {
  test("GET returns text and pending, PUT writes the file", async () => {
    const previous = process.env.PROFILE_PATH;
    process.env.PROFILE_PATH = "/tmp/job-agent-web-profile-test.md";
    try {
      await Bun.write(process.env.PROFILE_PATH, "profile v1");
      const id = offer(["hpp"]);
      expect(await call("/api/profile")).toMatchObject({ status: 200, body: { text: "profile v1", pending: 1 } });
      expect(await send("PUT", "/api/profile", { text: "profile v2" })).toMatchObject({ status: 200, body: { text: "profile v2", pending: 1 } });
      db.run("INSERT INTO offer_scores (offer_id, score, reason, gaps, model, profile_hash, scored_at) VALUES (?, 8, '', '', 't', ?, 't')", [id, profileHashOf("profile v2", scoreModel())]);
      expect(await call("/api/profile")).toMatchObject({ status: 200, body: { text: "profile v2", pending: 0 } });
      expect((await send("PUT", "/api/profile", {})).status).toBe(400);
      expect((await send("PUT", "/api/profile", { text: "  \n" })).status).toBe(400);
      expect(await Bun.file(process.env.PROFILE_PATH).text()).toBe("profile v2");
    } finally {
      if (previous === undefined) delete process.env.PROFILE_PATH;
      else process.env.PROFILE_PATH = previous;
    }
  });
});
