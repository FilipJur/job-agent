import { describe, expect, test } from "bun:test";
import { createHttpClient } from "../src/collectors/jobscz/http";

type Hit = { url: string; at: number };

/** Fake clock: sleep advances time, every fetch records its start time. No network. */
function harness(route: (url: string) => Response) {
  let clock = 0;
  const hits: Hit[] = [];
  const { fetchText } = createHttpClient({
    fetchImpl: async (url) => {
      hits.push({ url, at: clock });
      return route(url);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  return { fetchText, hits };
}

const ok = (body = "") => new Response(body, { status: 200 });
const serveRobots = (txt: string, status = 200) => (url: string) =>
  url.endsWith("/robots.txt") ? new Response(txt, { status }) : ok("page");

describe("jobs.cz http client", () => {
  test("throttles every request, robots.txt included", async () => {
    const { fetchText, hits } = harness(serveRobots("User-agent: *\nDisallow:"));
    await fetchText("https://www.jobs.cz/prace/?q=a&page=1");
    await fetchText("https://www.jobs.cz/prace/?q=a&page=2");
    await fetchText("https://www.jobs.cz/rpd/1/");
    expect(hits.map((h) => h.url)[0]).toBe("https://www.jobs.cz/robots.txt");
    expect(hits.length).toBe(4);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.at - hits[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
  });

  test("blocks /api/ and /iapi/ per robots.txt without requesting them", async () => {
    const { fetchText, hits } = harness(serveRobots("User-agent: *\nDisallow: /api/\nDisallow: /iapi/\n"));
    await expect(fetchText("https://www.jobs.cz/api/x")).rejects.toThrow(
      "robots.txt disallows https://www.jobs.cz/api/x",
    );
    await expect(fetchText("https://www.jobs.cz/iapi/y?z=1")).rejects.toThrow("robots.txt disallows");
    expect(hits.some((h) => h.url.includes("/api/") || h.url.includes("/iapi/"))).toBe(false);
    expect((await fetchText("https://www.jobs.cz/rpd/1/")).status).toBe(200);
  });

  test("robots 4xx allows all, 5xx disallows origin", async () => {
    const notFound = harness(serveRobots("", 404));
    expect((await notFound.fetchText("https://www.jobs.cz/rpd/1/")).status).toBe(200);
    const broken = harness(serveRobots("", 503));
    await expect(broken.fetchText("https://www.jobs.cz/rpd/1/")).rejects.toThrow("robots.txt disallows");
  });

  test("returns non-2xx status without throwing", async () => {
    const { fetchText } = harness((url) => (url.endsWith("/robots.txt") ? ok("") : new Response("nope", { status: 404 })));
    expect(await fetchText("https://www.jobs.cz/rpd/404/")).toEqual({
      status: 404,
      url: "https://www.jobs.cz/rpd/404/",
      body: "nope",
    });
  });
});
