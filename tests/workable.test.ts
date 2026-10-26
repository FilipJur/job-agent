import { describe, expect, test } from "bun:test";
import { createWorkableCollector, type FetchText } from "../src/collectors/workable";
import { parseJobList } from "../src/collectors/workable/api";
import { htmlToText } from "../src/collectors/workable/html";

const body = await Bun.file(new URL("./fixtures/workable/jobs-typescript-czechia.json", import.meta.url)).text();
const fixture = parseJobList(body);
const job = (title: string) => {
  const found = fixture.jobs.find((j) => j.title === title);
  if (!found) throw new Error(`fixture has no "${title}"`);
  return found;
};


/** Fake API: page 1 is the saved fixture (plus `token` when set), a token request serves the single `page2Id` job. */
function fakeApi(opts: { token?: string; page2Id?: string; status?: number } = {}) {
  const calls: string[] = [];
  const fetchText: FetchText = async (url) => {
    calls.push(url);
    if (opts.status) return { status: opts.status, url, body: "{}" };
    const sent = new URL(url).searchParams.get("pageToken");
    if (sent === null) return { status: 200, url, body: opts.token ? JSON.stringify({ ...JSON.parse(body), nextPageToken: opts.token }) : body };
    return { status: 200, url, body: JSON.stringify({ jobs: [fixture.jobs.find((j) => j.id === opts.page2Id)], totalSize: 1 }) };
  };
  return { fetchText, calls };
}

describe("workable collector", () => {
  test("maps a saved list response to full offers", async () => {
    const offers = await createWorkableCollector({
      fetchText: fakeApi().fetchText,
      queries: ["TypeScript"],
      maxPagesPerQuery: 1,
    }).collect();

    expect(offers.length).toBe(fixture.jobs.length);
    const qa = offers.find((o) => o.sourceId === job("QA Engineer for terminal").id);
    expect(qa).toMatchObject({
      source: "workable",
      url: "https://jobs.workable.com/view/tnMr1thQtqFspCX2W8cHVM/hybrid-qa-engineer-for-terminal-in-brno-at-ventrata",
      title: "QA Engineer for terminal",
      company: "Ventrata",
      city: "Brno",
      locationText: "Brno, Czechia",
      publishedAt: "2026-07-14T13:57:33.962Z",
      salaryMin: null,
      partial: false,
    });
    expect(qa?.tags).toEqual(["hybrid work", "Contract", "contractor", "Brno, Czechia"]);
    expect(qa?.description.startsWith("Imagine standing at the top of the Empire State Building")).toBe(true);
    expect(qa?.description).not.toContain("<");
    expect(qa?.description).toContain("Experience with software testing and QA methodologies.");
    const raw = qa?.raw;
    expect(typeof raw === "object" && raw !== null && "description" in raw).toBe(false);
  });

  test("remote workplace → fully remote; full-time adds no contractor tag", async () => {
    const offers = await createWorkableCollector({
      fetchText: fakeApi().fetchText,
      queries: ["TypeScript"],
      maxPagesPerQuery: 1,
    }).collect();

    const creditstar = offers.find((o) => o.sourceId === job("Senior Full Stack Engineer").id);
    expect(creditstar?.tags).toEqual(["fully remote", "Full-time", "Czechia"]);
    expect(creditstar?.city).toBeNull();
    expect(creditstar?.locationText).toBe("Czechia");
  });

  test("drops excluded companies case-insensitively", async () => {
    const offers = await createWorkableCollector({
      fetchText: fakeApi().fetchText,
      queries: ["TypeScript"],
      maxPagesPerQuery: 1,
      excludeCompanies: ["usercenTRICS"],
    }).collect();

    expect(offers.length).toBe(fixture.jobs.length - 1);
    expect(offers.some((o) => o.company === "Usercentrics")).toBe(false);
  });

  test("paginates with nextPageToken and dedupes ids across queries", async () => {
    const api = fakeApi({ token: "tok-2", page2Id: job("MarTech Lead").id });
    const offers = await createWorkableCollector({
      fetchText: api.fetchText,
      queries: ["TypeScript", "React"],
      maxPagesPerQuery: 2,
    }).collect();

    expect(api.calls.length).toBe(8);
    expect(api.calls.filter((u) => u.includes("pageToken=tok-2")).length).toBe(4);
    expect(api.calls[2]).toContain("workplace=remote");
    expect(api.calls[0]).not.toContain("workplace=");
    expect(offers.length).toBe(fixture.jobs.length);
  });

  test("--limit fetches one page per query", async () => {
    const api = fakeApi({ token: "tok-2", page2Id: job("MarTech Lead").id });
    await createWorkableCollector({ fetchText: api.fetchText, queries: ["TypeScript"], limit: 5 }).collect();

    expect(api.calls.length).toBe(2);
    expect(api.calls.some((u) => u.includes("pageToken"))).toBe(false);
  });

  test("throws only when every request fails", async () => {
    const allFail = createWorkableCollector({ fetchText: fakeApi({ status: 503 }).fetchText, queries: ["React"] });
    await expect(allFail.collect()).rejects.toThrow("all 2 Workable API requests failed");
  });

  test("htmlToText keeps blocks and decodes entities", () => {
    expect(htmlToText("<p>A&nbsp;&amp; B</p><ul><li>C</li><li>D</li></ul>")).toBe("A & B\nC\nD");
  });
});
