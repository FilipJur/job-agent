import { describe, expect, test } from "bun:test";
import { createHttpClient } from "../src/collectors/jobscz/http";

type Hit = { url: string; at: number; init?: RequestInit };

/** Fake clock: sleep advances time, every fetch records its start time. No network. */
function harness(route: (url: string) => Response, minIntervalMs?: number) {
  let clock = 0;
  const hits: Hit[] = [];
  const { fetchText } = createHttpClient({
    minIntervalMs,
    fetchImpl: async (url, init) => {
      hits.push({ url, at: clock, init });
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
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const serveRobots = (txt: string, status = 200) => (url: string) =>
  url.endsWith("/robots.txt") ? new Response(txt, { status }) : ok("page");
const allowed = (fetchText: (url: string) => Promise<unknown>, url: string) =>
  fetchText(url).then(
    () => true,
    () => false,
  );

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

  test("applies wildcards, $ anchor, Allow longest-match and only the * group", async () => {
    const robots = [
      "User-agent: Googlebot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /prace/",
      "Allow: /prace/?q=",
      "Disallow: /*.pdf$",
      "Disallow: /private*/secret",
    ].join("\n");
    const { fetchText, hits } = harness(serveRobots(robots));
    expect(await allowed(fetchText, "https://www.jobs.cz/rpd/1/")).toBe(true);
    expect(await allowed(fetchText, "https://www.jobs.cz/prace/?q=AI")).toBe(true);
    expect(await allowed(fetchText, "https://www.jobs.cz/prace/other")).toBe(false);
    expect(await allowed(fetchText, "https://www.jobs.cz/docs/a.pdf")).toBe(false);
    expect(await allowed(fetchText, "https://www.jobs.cz/docs/a.pdf?x=1")).toBe(true);
    expect(await allowed(fetchText, "https://www.jobs.cz/private1/secret/x")).toBe(false);
    expect(hits.filter((h) => h.url.endsWith("/robots.txt")).length).toBe(1);
  });

  test("robots 4xx allows all, 5xx disallows origin", async () => {
    const notFound = harness(serveRobots("", 404));
    expect((await notFound.fetchText("https://www.jobs.cz/rpd/1/")).status).toBe(200);
    const broken = harness(serveRobots("", 503));
    await expect(broken.fetchText("https://www.jobs.cz/rpd/1/")).rejects.toThrow("robots.txt disallows");
  });

  test("re-checks robots of a redirect target on another host", async () => {
    const route = (url: string) => {
      if (url === "https://beta.jobs.cz/robots.txt") return ok("User-agent: *\nDisallow: /nabidka/");
      if (url.endsWith("/robots.txt")) return ok("");
      if (url.startsWith("https://www.jobs.cz/rpd/")) return redirect("https://beta.jobs.cz/nabidka/abc/");
      return ok("detail");
    };
    const { fetchText, hits } = harness(route);
    await expect(fetchText("https://www.jobs.cz/rpd/1/")).rejects.toThrow(
      "robots.txt disallows https://beta.jobs.cz/nabidka/abc/",
    );
    expect(hits.some((h) => h.url === "https://beta.jobs.cz/robots.txt")).toBe(true);
    expect(hits.some((h) => h.url === "https://beta.jobs.cz/nabidka/abc/")).toBe(false);
  });

  test("follows allowed redirects across hosts and resolves relative Location", async () => {
    const route = (url: string) => {
      if (url.endsWith("/robots.txt")) return ok("");
      if (url === "https://www.jobs.cz/rpd/1/") return redirect("https://beta.jobs.cz/nabidka/abc/");
      if (url === "https://beta.jobs.cz/nabidka/abc/") return redirect("/nabidka/final/");
      return ok("detail");
    };
    const { fetchText } = harness(route);
    expect(await fetchText("https://www.jobs.cz/rpd/1/")).toEqual({
      status: 200,
      url: "https://beta.jobs.cz/nabidka/final/",
      body: "detail",
    });
  });

  test("throws on redirect loop beyond 5 hops", async () => {
    const { fetchText, hits } = harness((url) =>
      url.endsWith("/robots.txt") ? ok("") : redirect("https://www.jobs.cz/loop/"),
    );
    await expect(fetchText("https://www.jobs.cz/loop/")).rejects.toThrow("too many redirects");
    expect(hits.filter((h) => h.url === "https://www.jobs.cz/loop/").length).toBe(6);
  });

  test("returns non-2xx status without throwing", async () => {
    const { fetchText } = harness((url) => (url.endsWith("/robots.txt") ? ok("") : new Response("nope", { status: 404 })));
    expect(await fetchText("https://www.jobs.cz/rpd/404/")).toEqual({
      status: 404,
      url: "https://www.jobs.cz/rpd/404/",
      body: "nope",
    });
  });

  test("sends browser User-Agent and Czech Accept-Language", async () => {
    const { fetchText, hits } = harness(serveRobots(""));
    await fetchText("https://www.jobs.cz/rpd/1/");
    const headers = new Headers(hits.at(-1)?.init?.headers);
    expect(headers.get("user-agent")).toContain("Chrome/");
    expect(headers.get("accept-language")).toBe("cs-CZ,cs;q=0.9,en;q=0.8");
  });
});
