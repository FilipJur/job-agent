import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createCachedFetch } from "../src/http-cache";
import type { FetchText } from "../src/types";

/** Fake fetcher: records every call, answers with a distinctive body so mixing up entries is visible. */
const fake = (calls: string[]): FetchText => async (url) => {
  calls.push(url);
  return { status: 200, url: `${url}#final`, body: `<h1>${url}</h1>` };
};

describe("http-cache", () => {
  test("record then replay returns the same triple with zero replay fetches", async () => {
    const dir = await mkdtemp(join(import.meta.dir, ".tmp-http-cache-"));
    try {
      const url = "https://www.jobs.cz/rpd/1/?q=a";
      const recorded: string[] = [];
      const first = await createCachedFetch(fake(recorded), { mode: "record", dir })(url);
      expect(recorded).toEqual([url]);

      const replayed: string[] = [];
      const second = await createCachedFetch(fake(replayed), { mode: "replay", dir })(url);
      expect(second).toEqual({ status: first.status, url: first.url, body: first.body });
      expect(replayed).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("replay with an empty cache throws naming the URL", async () => {
    const dir = await mkdtemp(join(import.meta.dir, ".tmp-http-cache-"));
    try {
      const url = "https://www.jobs.cz/rpd/missing/";
      const replay = createCachedFetch(fake([]), { mode: "replay", dir });
      await expect(replay(url)).rejects.toThrow(url);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
