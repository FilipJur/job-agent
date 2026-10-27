export interface PushDigestOptions {
  url: string;
  title: string;
  body: string;
  clickUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type PushDigestResult = { ok: true } | { ok: false; error: string };

const PUSH_TIMEOUT_MS = 10_000;

/**
 * HTTP header values must be latin-1; Czech titles ("Ranní přehled – …") are not.
 * Fold to ASCII for the `Title` header only — the markdown body keeps diacritics.
 */
export function headerTitle(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-");
}
/**
 * POSTs the digest to an ntfy topic the user owns. Never throws and never logs:
 * the caller prints `error` with the secret URL redacted.
 */
export async function pushDigest(opts: PushDigestOptions): Promise<PushDigestResult> {
  try {
    const headers: Record<string, string> = { Title: headerTitle(opts.title) };
    if (opts.clickUrl !== undefined && opts.clickUrl !== "") headers.Click = opts.clickUrl;
    const res = await (opts.fetchFn ?? fetch)(opts.url, {
      method: "POST",
      body: opts.body,
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? PUSH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `ntfy answered ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
