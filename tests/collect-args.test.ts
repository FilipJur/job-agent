import { describe, expect, test } from "bun:test";
import { COLLECTORS } from "../src/cli/collect";
import type { FetchText } from "../src/types";

const fixture = (name: string) => Bun.file(new URL(`./fixtures/jobscz/${name}`, import.meta.url)).text();
const serp = await fixture("serp-ai-engineer.html");
const detail = await fixture("detail-jsonld.html");
const EMPTY = "<html><body></body></html>";

describe("collect CLI", () => {
  test("--limit maps to one SERP page per keyword and at most N detail fetches", async () => {
    const calls: string[] = [];
    const fetchText: FetchText = async (url) => {
      calls.push(url);
      const u = new URL(url);
      const body = u.pathname.startsWith("/rpd/") ? detail : u.searchParams.get("page") === "1" ? serp : EMPTY;
      return { status: 200, url, body };
    };

    await COLLECTORS.jobscz!({ fetchText, limit: 2, isKnown: () => false }).collect();

    // Keyword selection comes from config: every keyword asks for page 1 only, and `--limit 2` caps the details.
    const serpPages = calls.filter((u) => u.includes("/prace/")).map((u) => new URL(u).searchParams.get("page"));
    expect(serpPages.length).toBeGreaterThan(0);
    expect(serpPages.every((page) => page === "1")).toBe(true);
    expect(calls.filter((u) => u.includes("/rpd/")).length).toBe(2);
  });
});
