import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { COLLECT_GUARD_MS, dueSources, lastOkRunAt } from "../src/cli/collect";

const H = 3600 * 1000;
const NOW = new Date("2026-10-26T12:00:00.000Z").getTime();

function dbWithRuns(rows: { source: string; startedAt: string; status: "ok" | "error" }[]): Database {
  const db = openDb(":memory:");
  const insert = db.prepare("INSERT INTO runs (source, started_at, finished_at, status) VALUES (?, ?, ?, ?)");
  for (const r of rows) insert.run(r.source, r.startedAt, r.startedAt, r.status);
  return db;
}

const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe("daily guard", () => {
  test("ok run 2h ago is skipped", () => {
    const db = dbWithRuns([{ source: "jobscz", startedAt: ago(2 * H), status: "ok" }]);
    try {
      expect(dueSources(db, ["jobscz"], { nowMs: NOW }).skipped).toEqual(["jobscz"]);
    } finally {
      db.close();
    }
  });

  test("ok run 25h ago or only error runs are collected", () => {
    const db = dbWithRuns([
      { source: "jobscz", startedAt: ago(25 * H), status: "ok" },
      { source: "hn", startedAt: ago(1 * H), status: "error" },
    ]);
    try {
      const { due, skipped } = dueSources(db, ["jobscz", "hn"], { nowMs: NOW });
      expect(due).toEqual(["jobscz", "hn"]);
      expect(skipped).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("--force collects everything", () => {
    const db = dbWithRuns([{ source: "jobscz", startedAt: ago(2 * H), status: "ok" }]);
    try {
      expect(dueSources(db, ["jobscz"], { force: true, nowMs: NOW }).due).toEqual(["jobscz"]);
    } finally {
      db.close();
    }
  });

  test("boundary: exactly 20h ago is due", () => {
    const db = dbWithRuns([{ source: "jobscz", startedAt: ago(COLLECT_GUARD_MS), status: "ok" }]);
    try {
      expect(lastOkRunAt(db, "jobscz")).toBe(ago(COLLECT_GUARD_MS));
      expect(dueSources(db, ["jobscz"], { nowMs: NOW }).due).toEqual(["jobscz"]);
    } finally {
      db.close();
    }
  });
});
