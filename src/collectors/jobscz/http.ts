import type { FetchText } from "../../types";

export type { FetchText } from "../../types";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
};

export interface HttpClientOptions {
  minIntervalMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Rule = { allow: boolean; prefix: string };

const BLOCK_ALL: Rule[] = [{ allow: false, prefix: "/" }];

/** Disallow/Allow paths of the `User-agent: *` group; entries are plain prefixes, `*` and `$` are not interpreted. */
function parseRobots(text: string): Rule[] {
  const star = text.split(/^\s*user-agent\s*:/im).find((group) => group.trimStart().startsWith("*")) ?? "";
  return [...star.matchAll(/^[ \t]*(allow|disallow)\s*:\s*([^#\n]+)/gim)].map(
    ([, kind = "", prefix = ""]) => ({ allow: kind.toLowerCase() === "allow", prefix: prefix.trim() }),
  );
}

export function createHttpClient(opts: HttpClientOptions = {}): { fetchText: FetchText } {
  const { minIntervalMs = 1000, fetchImpl = fetch, sleep = Bun.sleep, now = Date.now } = opts;

  // Sequential throttle: each request starts at least minIntervalMs after the previous one.
  let last = Number.NEGATIVE_INFINITY;
  const gate = async (): Promise<void> => {
    await sleep(Math.max(0, last + minIntervalMs - now()));
    last = now();
  };

  const robots = new Map<string, Rule[]>();
  const rulesFor = async (origin: string): Promise<Rule[]> => {
    const cached = robots.get(origin);
    if (cached) return cached;
    await gate();
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: HEADERS, redirect: "follow" }).catch(() => null);
    // 2xx parses; 4xx means no robots.txt (allow all); 5xx or a network error blocks.
    const rules = res && res.status >= 400 && res.status < 500 ? [] : res?.ok ? parseRobots(await res.text()) : BLOCK_ALL;
    robots.set(origin, rules);
    return rules;
  };

  const fetchText: FetchText = async (url) => {
    const target = new URL(url);
    const rules = await rulesFor(target.origin);
    // Blocked when a Disallow prefix matches and no Allow prefix does.
    const hit = (allow: boolean) => rules.some((r) => r.allow === allow && (target.pathname + target.search).startsWith(r.prefix));
    if (hit(false) && !hit(true)) throw new Error(`robots.txt disallows ${url}`);
    await gate();
    const res = await fetchImpl(url, { headers: HEADERS, redirect: "follow" });
    return { status: res.status, url: res.url || url, body: await res.text() };
  };
  return { fetchText };
}
