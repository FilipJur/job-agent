export type FetchText = (url: string) => Promise<{ status: number; url: string; body: string }>;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 5;

interface Rule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

export interface HttpClientOptions {
  minIntervalMs?: number;
  userAgent?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const ALLOW_ALL: Rule[] = [];
const DISALLOW_ALL: Rule[] = [toRule(false, "/")];

/** robots.txt pattern → anchored regex: `*` wildcard, trailing `$` anchor, otherwise prefix match. */
function toRule(allow: boolean, pattern: string): Rule {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return { allow, pattern, re: new RegExp(`^${body}${anchored ? "$" : ""}`) };
}

/** Rules of the `User-agent: *` group only. */
function parseRobots(text: string): Rule[] {
  const rules: Rule[] = [];
  let applies = false;
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (inRules) {
        applies = false;
        inRules = false;
      }
      if (value === "*") applies = true;
    } else if (key === "allow" || key === "disallow") {
      inRules = true;
      if (applies && value) rules.push(toRule(key === "allow", value));
    }
  }
  return rules;
}

/** Longest matching pattern wins; on equal length Allow wins. No match → allowed. */
function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | undefined;
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
      best = r;
    }
  }
  return best ? best.allow : true;
}

export function createHttpClient(opts: HttpClientOptions = {}): { fetchText: FetchText } {
  const minIntervalMs = opts.minIntervalMs ?? 1000;
  const headers = {
    "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    Accept: "text/html,application/xhtml+xml",
  };
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep =
    opts.sleep ??
    ((ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    });
  const now = opts.now ?? (() => Date.now());

  // Global throttle: each outgoing request starts at least minIntervalMs after the previous one.
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  const gate = (): Promise<void> => {
    const turn = queue.then(async () => {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
    });
    queue = turn.catch(() => undefined);
    return turn;
  };

  const robots = new Map<string, Promise<Rule[]>>();
  const fetchRobots = async (origin: string): Promise<Rule[]> => {
    try {
      await gate();
      const res = await fetchImpl(`${origin}/robots.txt`, { headers, redirect: "follow" });
      if (res.status >= 500) return DISALLOW_ALL;
      if (res.status >= 200 && res.status < 300) return parseRobots(await res.text());
      return ALLOW_ALL;
    } catch {
      return DISALLOW_ALL;
    }
  };
  const rulesFor = (origin: string): Promise<Rule[]> => {
    let rules = robots.get(origin);
    if (!rules) {
      rules = fetchRobots(origin);
      robots.set(origin, rules);
    }
    return rules;
  };

  const assertAllowed = async (url: string): Promise<void> => {
    const u = new URL(url);
    if (!isAllowed(await rulesFor(u.origin), u.pathname + u.search)) {
      throw new Error(`robots.txt disallows ${url}`);
    }
  };

  const fetchText: FetchText = async (start) => {
    let url = start;
    for (let redirects = 0; ; redirects++) {
      await assertAllowed(url);
      await gate();
      const res = await fetchImpl(url, { headers, redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (redirects >= MAX_REDIRECTS) throw new Error(`too many redirects starting at ${start}`);
        url = new URL(location, url).href;
        continue;
      }
      return { status: res.status, url, body: await res.text() };
    }
  };

  return { fetchText };
}
