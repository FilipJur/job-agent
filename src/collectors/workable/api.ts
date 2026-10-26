/** The parts of the Workable job-search API (`jobs.workable.com/api/v1/jobs`) the collector reads. */
export interface WorkableJob {
  id: string;
  title: string;
  url: string;
  created?: string;
  department?: string;
  employmentType?: string;
  workplace?: string;
  location?: { city?: string; subregion?: string | null; countryName?: string };
  description?: string;
  requirementsSection?: string;
  benefitsSection?: string;
  company?: { id?: string; title?: string };
}

export interface JobList {
  jobs: WorkableJob[];
  nextPageToken: string | null;
}

/** An item without id/title/url cannot be stored, so it is not an offer. */
function isJob(value: unknown): value is WorkableJob {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}

/** One list response holds complete offers; only the shape the collector reads is checked. */
export function parseJobList(body: string): JobList {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("jobs" in parsed) || !Array.isArray(parsed.jobs)) {
    throw new Error("unexpected Workable response: no jobs array");
  }
  const token = "nextPageToken" in parsed ? parsed.nextPageToken : undefined;
  return {
    jobs: parsed.jobs.filter(isJob),
    nextPageToken: typeof token === "string" && token.length > 0 ? token : null,
  };
}
