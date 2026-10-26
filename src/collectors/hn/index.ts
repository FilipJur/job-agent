import config from "../../../config/hn.json";
import type { Collector, FetchText, RawOffer } from "../../types";
import { newestHiringThread, parseHeader, topLevelComments, type HnHit } from "./parse";
import { htmlToText } from "./text";

const SOURCE = "hn";
const API = "https://hn.algolia.com/api/v1";
/** Algolia's own index of the monthly threads; the newest hiring thread is the target. */
const THREADS_URL = `${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=5`;

export interface HnOptions {
  /** Injected HTTP client (record/replay cache in the CLI); the collector never calls `fetch` itself. */
  fetchText: FetchText;
  /** From `--limit`: every comment carries its full text, so a limited run just asks the first query. */
  limit?: number | null;
}

/** Algolia search hit -> RawOffer; the comment's own HTML is the only per-offer data there is. */
function toRawOffer(hit: HnHit, thread: HnHit, query: string): RawOffer {
  const text = htmlToText(hit.comment_text ?? "");
  const { company, title, locationText, tags } = parseHeader(text.split("\n")[0] ?? "");
  return {
    source: SOURCE,
    sourceId: hit.objectID,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title,
    company,
    locationText,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    publishedAt: hit.created_at ?? null,
    description: text,
    tags,
    partial: false,
    raw: {
      objectID: hit.objectID,
      parentId: hit.parent_id ?? null,
      storyId: thread.objectID,
      storyTitle: thread.title ?? null,
      author: hit.author ?? null,
      createdAt: hit.created_at ?? null,
      query,
    },
  };
}

export function createHnCollector(opts: HnOptions): Collector {
  const { fetchText, limit = null } = opts;
  const { queries, hitsPerPage } = config.hn;

  return {
    name: SOURCE,
    async collect() {
      const threads = await fetchText(THREADS_URL);
      if (threads.status !== 200) throw new Error(`HTTP ${threads.status} for ${THREADS_URL}`);
      const thread = newestHiringThread(threads.body);
      if (!thread) throw new Error(`no "Ask HN: Who is hiring?" story in ${THREADS_URL}`);
      const wanted = limit === null ? queries : queries.slice(0, 1);

      const offers = new Map<string, RawOffer>();
      const errors: string[] = [];
      for (const query of wanted) {
        const url =
          `${API}/search?tags=comment,story_${thread.objectID}` +
          `&query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
        try {
          const res = await fetchText(url);
          if (res.status !== 200) {
            errors.push(`HTTP ${res.status} for ${url}`);
            continue;
          }
          for (const hit of topLevelComments(res.body, thread.objectID)) {
            if (!offers.has(hit.objectID)) offers.set(hit.objectID, toRawOffer(hit, thread, query));
          }
        } catch (e) {
          errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // One failed query still leaves the others' offers; only a run with no data at all is a source failure.
      if (wanted.length > 0 && errors.length === wanted.length) {
        throw new Error(`all ${wanted.length} HN Algolia queries failed; first: ${errors[0]}`);
      }
      return [...offers.values()];
    },
  };
}
