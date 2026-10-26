import config from "../../../config/workable.json";
import type { Collector, FetchText, RawOffer } from "../../types";
import { parseJobList, type WorkableJob } from "./api";
import { htmlToText } from "./html";

export type { FetchText } from "../../types";

export interface WorkableOptions {
  fetchText: FetchText;
  /** `--limit N`: one list page per query instead of the configured maximum. */
  limit?: number | null;
  queries?: string[];
  location?: string;
  maxPagesPerQuery?: number;
  /** AI-training-task farms (Mindrift) that flood the search results. */
  excludeCompanies?: string[];
}

const SOURCE = "workable";
const API = "https://jobs.workable.com/api/v1/jobs";

/** Workable's workplace enum to the canonical work-mode tags rule labels read. */
const WORKPLACE_TAGS: Record<string, string> = {
  remote: "fully remote",
  hybrid: "hybrid work",
  on_site: "on-site",
};

const CONTRACT_TYPES = /^(contract|freelance)$/i;

export function createWorkableCollector(opts: WorkableOptions): Collector {
  const { fetchText } = opts;
  const queries = opts.queries ?? config.queries;
  const location = opts.location ?? config.location;
  const maxPages = opts.limit != null ? 1 : (opts.maxPagesPerQuery ?? config.maxPagesPerQuery);
  const excluded = new Set((opts.excludeCompanies ?? config.excludeCompanies).map((name) => name.toLowerCase()));

  const urlFor = (query: string, remote: boolean, pageToken: string | null): string => {
    const params = new URLSearchParams({ query, location });
    if (remote) params.set("workplace", "remote");
    if (pageToken !== null) params.set("pageToken", pageToken);
    return `${API}?${params}`;
  };

  function toRawOffer(job: WorkableJob): RawOffer | null {
    const company = job.company?.title?.trim() || null;
    if (company !== null && excluded.has(company.toLowerCase())) return null;

    const city = job.location?.city?.trim() || null;
    const country = job.location?.countryName?.trim() || null;
    const locationText = [city, country].filter(Boolean).join(", ") || null;

    const description = [job.description, job.requirementsSection, job.benefitsSection]
      .map((section) => (section ? htmlToText(section) : ""))
      .filter(Boolean)
      .join("\n\n");

    const employmentType = job.employmentType?.trim() || "";
    const tags = [
      WORKPLACE_TAGS[job.workplace ?? ""] ?? "",
      employmentType,
      CONTRACT_TYPES.test(employmentType) ? "contractor" : "",
      locationText ?? "",
    ].filter(Boolean);

    return {
      source: SOURCE,
      sourceId: job.id,
      url: job.url,
      title: job.title.trim(),
      company,
      locationText,
      city,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      publishedAt: job.created ?? null,
      description,
      tags: [...new Set(tags)],
      partial: description.length === 0,
      raw: {
        id: job.id,
        title: job.title,
        url: job.url,
        created: job.created ?? null,
        department: job.department ?? null,
        employmentType: employmentType || null,
        workplace: job.workplace ?? null,
        location: job.location ?? null,
        company: job.company ? { id: job.company.id ?? null, title: company } : null,
        detailError: null,
      },
    };
  }

  return {
    name: SOURCE,
    async collect() {
      const offers = new Map<string, RawOffer>();
      const errors: string[] = [];
      let attempts = 0;

      for (const query of queries) {
        // The plain query usually covers remote offers; the explicit workplace=remote pass is deduped by id below.
        for (const remote of [false, true]) {
          let pageToken: string | null = null;
          for (let page = 0; page < maxPages; page++) {
            const url = urlFor(query, remote, pageToken);
            attempts++;
            let list;
            try {
              const res = await fetchText(url);
              if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
              list = parseJobList(res.body);
            } catch (e) {
              errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
              break;
            }
            for (const job of list.jobs) {
              if (offers.has(job.id)) continue;
              const offer = toRawOffer(job);
              if (offer !== null) offers.set(job.id, offer);
            }
            pageToken = list.nextPageToken;
            if (pageToken === null || list.jobs.length === 0) break;
          }
        }
      }

      if (attempts > 0 && errors.length === attempts) {
        throw new Error(`all ${attempts} Workable API requests failed; first: ${errors[0]}`);
      }
      return [...offers.values()];
    },
  };
}
