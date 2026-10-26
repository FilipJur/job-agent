import { describe, expect, test } from "bun:test";
import { createHnCollector } from "../src/collectors/hn";
import { newestHiringThread, parseHeader, topLevelComments } from "../src/collectors/hn/parse";
import { htmlToText } from "../src/collectors/hn/text";
import type { FetchText } from "../src/types";

const fixture = (name: string) => Bun.file(new URL(`./fixtures/hn/${name}`, import.meta.url)).text();
const threads = await fixture("threads.json");
const remote = await fixture("comments-remote-europe.json");
const contract = await fixture("comments-contract.json");
const STORY = newestHiringThread(threads)!.objectID;

const queryOf = (url: string) => new URL(url).searchParams.get("query") ?? "";
/** Fake Algolia: the author listing plus one fixture per query; unknown queries 404 like a filtered-out search. */
function algolia(override: (url: string) => { status: number; body: string } | null = () => null) {
  const calls: string[] = [];
  const fetchText: FetchText = async (url) => {
    calls.push(url);
    const reply =
      override(url) ??
      (url.includes("tags=story")
        ? { status: 200, body: threads }
        : queryOf(url) === "REMOTE Europe"
          ? { status: 200, body: remote }
          : queryOf(url) === "contract"
            ? { status: 200, body: contract }
            : null);
    return reply ? { ...reply, url } : { status: 404, url, body: "" };
  };
  return { fetchText, calls };
}

describe("hn thread parsing", () => {
  test("newest hiring thread, ignoring the 'wants to be hired' twin and older months", () => {
    const thread = newestHiringThread(threads)!;
    expect(thread.objectID).toBe("49922569");
    expect(thread.title).toBe("Ask HN: Who is hiring? (October 2026)");
  });

  test("keeps top-level comments only, dropping replies", () => {
    const hits = JSON.parse(contract).hits as { objectID: string; parent_id: unknown }[];
    const top = topLevelComments(contract, STORY);
    expect(top).toHaveLength(35);
    expect(hits).toHaveLength(40);
    expect(top.every((h) => String(h.parent_id) === STORY)).toBe(true);
  });
});

describe("hn header mapping", () => {
  test("splits company, role and location, and tags REMOTE as fully remote", () => {
    const hit = topLevelComments(remote, STORY).find((h) => h.objectID === "50075162")!;
    const text = htmlToText(hit.comment_text!);
    const [header = "", ...rest] = text.split("\n");
    const parsed = parseHeader(header);
    expect(parsed.company).toBe("Baserow");
    expect(parsed.title).toBe("Product Specialist");
    expect(parsed.locationText).toBe("REMOTE (Europe)");
    expect(parsed.tags).toContain("fully remote");
    expect(parsed.tags).not.toContain("contractor");
    // The comment body keeps its paragraphs and loses the anchor markup/entities.
    expect(rest.join("\n")).toContain("We're building an open-source no-code platform");
    expect(text).not.toContain("<a href");
    expect(text).not.toContain("&#x2F;");
  });

  test("skips a location in the role position and tags contract/freelance posts as contractor", () => {
    const mainmatter = parseHeader("Mainmatter (https://mainmatter.com/) | REMOTE (EU) | Lead Rust Consultant | Full-time");
    expect(mainmatter.company).toBe("Mainmatter");
    expect(mainmatter.title).toBe("Lead Rust Consultant");
    const parsed = parseHeader("Irash Tech | Business Development Manager | REMOTE (Worldwide) | Contract");
    expect(parsed.tags).toContain("contractor");
    expect(parseHeader("No separator here").title).toBe("No separator here");
  });

  test("role segment never becomes the location when a URL sits between them", () => {
    const coder = parseHeader("Coder | https://coder.com/ | Multiple roles | Multiple locations");
    expect(coder.title).toBe("Multiple roles");
    expect(coder.locationText).toBe("Multiple locations");
  });
});

describe("hn collector", () => {
  test("dedupes offers across queries and maps the comment fields", async () => {
    const { fetchText, calls } = algolia();
    const offers = await createHnCollector({ fetchText }).collect();

    expect(calls.filter((u) => u.includes("tags=comment"))).toHaveLength(4); // every configured query is asked
    expect(offers).toHaveLength(49); // 20 + 35 with 6 ids in both queries
    expect(new Set(offers.map((o) => o.sourceId)).size).toBe(49);
    const baserow = offers.find((o) => o.sourceId === "50075162")!;
    expect(baserow).toMatchObject({
      source: "hn",
      url: "https://news.ycombinator.com/item?id=50075162",
      company: "Baserow",
      title: "Product Specialist",
      locationText: "REMOTE (Europe)",
      publishedAt: "2026-10-13T17:11:22Z",
      partial: false,
    });
    expect(baserow.tags).toContain("fully remote");
    expect(baserow.raw).toMatchObject({ objectID: "50075162", storyId: STORY });
  });

  test("--limit asks only the first query", async () => {
    const { fetchText, calls } = algolia();
    const offers = await createHnCollector({ fetchText, limit: 5 }).collect();
    expect(calls.filter((u) => u.includes("tags=comment"))).toHaveLength(1);
    expect(offers).toHaveLength(20);
  });

  test("one failing query still returns the other queries' offers", async () => {
    const { fetchText } = algolia((url) => (queryOf(url) === "contract" ? { status: 500, body: "" } : null));
    const offers = await createHnCollector({ fetchText }).collect();
    expect(offers).toHaveLength(20);
  });

  test("throws when every query fails or the thread listing is unavailable", async () => {
    const failing = algolia((url) => (url.includes("tags=story") ? null : { status: 503, body: "" }));
    await expect(createHnCollector({ fetchText: failing.fetchText }).collect()).rejects.toThrow(
      "all 4 HN Algolia queries failed",
    );
    const noThreads = algolia((url) => (url.includes("tags=story") ? { status: 500, body: "" } : null));
    await expect(createHnCollector({ fetchText: noThreads.fetchText }).collect()).rejects.toThrow("HTTP 500");
  });
});
