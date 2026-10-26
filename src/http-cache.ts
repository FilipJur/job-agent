import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FetchText = (url: string) => Promise<{ status: number; url: string; body: string }>;

export type HttpMode = "live" | "record" | "replay";

interface CacheEntry {
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  fetchedAt: string;
}

/** Wraps a fetcher with an on-disk cache: `record` writes one JSON file per URL, `replay` serves them without network. */
export function createCachedFetch(inner: FetchText, opts: { mode: HttpMode; dir: string }): FetchText {
  const { mode, dir } = opts;
  if (mode === "live") return inner;

  // One file per exact URL string: lowercase hex sha256, so keys are stable across runs and hosts.
  const pathFor = (url: string): string => join(dir, `${createHash("sha256").update(url).digest("hex")}.json`);

  return async (url) => {
    if (mode === "record") {
      const res = await inner(url);
      const entry: CacheEntry = { url, finalUrl: res.url, status: res.status, body: res.body, fetchedAt: new Date().toISOString() };
      await mkdir(dir, { recursive: true });
      await writeFile(pathFor(url), `${JSON.stringify(entry, null, 2)}\n`);
      return res;
    }

    let text: string;
    try {
      text = await readFile(pathFor(url), "utf8");
    } catch {
      throw new Error(`http-cache miss (replay mode, no network): ${url}`);
    }
    let entry: CacheEntry;
    try {
      entry = JSON.parse(text) as CacheEntry;
    } catch {
      throw new Error(`http-cache corrupt entry for ${url}: ${pathFor(url)}`);
    }
    if (typeof entry.status !== "number" || typeof entry.body !== "string" || typeof entry.finalUrl !== "string") {
      throw new Error(`http-cache corrupt entry for ${url}: ${pathFor(url)}`);
    }
    return { status: entry.status, url: entry.finalUrl, body: entry.body };
  };
}
