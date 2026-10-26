import { describe, expect, test } from "bun:test";
import { COLLECTORS, collectorOptions, parseArgs } from "../src/cli/collect";
import { createJobsCzCollector, type FetchText } from "../src/collectors/jobscz";

const fixture = (name: string) => Bun.file(new URL(`./fixtures/jobscz/${name}`, import.meta.url)).text();
const serp = await fixture("serp-ai-engineer.html");
const detail = await fixture("detail-jsonld.html");
const EMPTY = "<html><body></body></html>";

describe("collect CLI args", () => {
  test("no flags runs every collector with collector defaults", () => {
    expect(parseArgs([])).toEqual({ sources: [], limit: null });
    expect(collectorOptions(null)).toEqual({});
  });

  test("parses repeatable --source and --limit", () => {
    expect(parseArgs(["--source", "jobscz", "--limit", "2"])).toEqual({ sources: ["jobscz"], limit: 2 });
    expect(parseArgs(["--source=jobscz", "--limit=1"])).toEqual({ sources: ["jobscz"], limit: 1 });
  });

  test("rejects a missing, non-numeric or non-positive --limit", () => {
    expect(() => parseArgs(["--limit", "abc"])).toThrow();
    expect(() => parseArgs(["--limit", "0"])).toThrow();
    expect(() => parseArgs(["--limit"])).toThrow();
  });

  test("--limit maps to one SERP page and at most N detail fetches", async () => {
    expect(collectorOptions(2)).toEqual({ maxPagesPerKeyword: 1, maxDetails: 2 });
    const calls: string[] = [];
    const fetchText: FetchText = async (url) => {
      calls.push(url);
      const u = new URL(url);
      const body = u.pathname.startsWith("/rpd/") ? detail : u.searchParams.get("page") === "1" ? serp : EMPTY;
      return { status: 200, url, body };
    };
    expect(COLLECTORS.jobscz!({ fetchText, limit: 2, isKnown: () => false }).name).toBe("jobscz");

    // Keyword selection comes from config, so pin one here and reuse the CLI's limit mapping.
    await createJobsCzCollector({
      ...collectorOptions(2),
      keywords: ["AI engineer"],
      fetchText,
      isKnown: () => false,
    }).collect();

    expect(calls.filter((u) => u.includes("/prace/")).length).toBe(1);
    expect(calls.filter((u) => u.includes("/rpd/")).length).toBe(2);
  });
});
