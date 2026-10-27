/*
 * job-agent offline shell. Hand-written, no build step.
 * Bump VERSION when this file's caching rules change: activate deletes every cache that is not current.
 *
 * - /assets/* (hashed by Vite): cache-first.
 * - navigations ("/"): network-first, cached shell as fallback.
 * - GET /api/offers*, /api/triage*, /api/agencies, /api/applications, /api/market: network-first, cached copy as
 *   fallback. A copy served from the cache carries `x-sw-cache: <iso time it was stored>`; the UI shows it as the
 *   "offline — data z <čas>" line. Fresh network responses are passed through untouched (no header).
 * - Anything that is not GET is never touched.
 */
const VERSION = "job-agent-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const CURRENT = [SHELL_CACHE, API_CACHE];

/* Matched against pathname + search so /api/offers/12/draft and friends stay uncached. */
const CACHEABLE_API = /^\/api\/(offers|triage|agencies|applications|market)(\?|$)/;

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch("/", { cache: "reload" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put("/", response);
  const assets = new Set([...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg|png|webmanifest))"/g)].map((m) => m[1]));
  for (const url of [...assets]) {
    if (!url.endsWith(".css")) continue;
    const css = await fetch(url).then((r) => (r.ok ? r.text() : ""));
    for (const m of css.matchAll(/url\((\/[^)]+)\)/g)) assets.add(m[1]);
  }
  await Promise.all([...assets].map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function storeApi(request, response) {
  const headers = new Headers(response.headers);
  headers.set("x-sw-cache", new Date().toISOString());
  const stamped = new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
  await (await caches.open(API_CACHE)).put(request, stamped);
}

async function apiNetworkFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(storeApi(request, response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    const hit = await (await caches.open(API_CACHE)).match(request);
    if (hit) return hit;
    throw error;
  }
}

async function shellNetworkFirst(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put("/", response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    const hit = await cache.match("/");
    if (hit) return hit;
    throw error;
  }
}

async function assetCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (CACHEABLE_API.test(url.pathname + url.search)) {
    event.respondWith(apiNetworkFirst(event));
  } else if (request.mode === "navigate") {
    event.respondWith(shellNetworkFirst(event));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(assetCacheFirst(request));
  }
});
