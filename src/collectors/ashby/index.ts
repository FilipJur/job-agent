import config from "../../../config/ashby.json";
import type { Collector, FetchText, RawOffer } from "../../types";
import { parseBoard, SOURCE, type AshbyOrg } from "./parse";

export interface AshbyOptions {
  fetchText: FetchText;
  /** Orgs to query; defaults to config/ashby.json. */
  orgs?: AshbyOrg[];
  /** Cap on org requests (`--limit`). */
  maxOrgs?: number;
}

const BOARD = "https://api.ashbyhq.com/posting-api/job-board";

export function createAshbyCollector(opts: AshbyOptions): Collector {
  const orgs = (opts.orgs ?? config.ashby.orgs).slice(0, opts.maxOrgs ?? Infinity);

  return {
    name: SOURCE,
    async collect() {
      const offers: RawOffer[] = [];
      const errors: string[] = [];
      for (const org of orgs) {
        const url = `${BOARD}/${encodeURIComponent(org.id)}?includeCompensation=true`;
        try {
          const res = await opts.fetchText(url);
          // 404 means the org has no public Ashby board; skip it and keep the run going.
          if (res.status === 404) {
            console.warn(`ashby: no job board for "${org.id}" (HTTP 404), skipped`);
            continue;
          }
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          offers.push(...parseBoard(res.body, org.name, org.departments));
        } catch (e) {
          errors.push(`${org.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (errors.length > 0 && errors.length === orgs.length) {
        throw new Error(`all ${orgs.length} Ashby org boards failed; first: ${errors[0] ?? ""}`);
      }
      return offers;
    },
  };
}
