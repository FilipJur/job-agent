# Collector contract

How to add a source. `src/collectors/jobscz/` is the reference implementation.

## Layout (one source = one directory)
- `src/collectors/<source>/index.ts` exports `create<Source>Collector(opts)` returning a `Collector` (`src/types.ts`).
- `config/<source>.json` holds queries/orgs/limits for that source only. Do not edit `config/sources.json` (jobs.cz).
- `tests/<source>.test.ts` + `tests/fixtures/<source>/` (real responses, saved once).
- Do not edit `src/types.ts`, `src/pipeline.ts`, `src/normalize.ts`, `src/labels/*`, `src/db.ts`, other collectors. Need a change there? Stop and report.

## Options
```ts
interface Options {
  fetchText: FetchText;                    // injected; never call fetch() directly
  isKnown?: (sourceId: string) => boolean; // skip per-offer detail requests for known ids
  maxDetails?: number;                     // cap on per-offer detail requests (from --limit)
}
```
- HTTP: the CLI passes a `FetchText` built from `createHttpClient()` (`src/collectors/jobscz/http.ts`: 1 req/s, robots.txt prefix rules) wrapped by the record/replay cache. JSON APIs return text; `JSON.parse` it.
- A source with no per-offer detail request ignores `isKnown`/`maxDetails` except that `--limit N` should cap the number of list requests to something small.
- Throw only when the whole source fails; per-offer problems go into `raw` and the offer is still returned.

## Mapping to `RawOffer`
- `sourceId`: the source's stable id (string). `url`: the public offer page, not the API URL.
- `description`: plain text (strip HTML). `partial: true` when the text is clearly truncated or missing.
- `publishedAt`: ISO string when the source has it.
- `city`: only when the source states it explicitly; otherwise `locationText` and let normalization derive it.
  Pass the raw location; normalization canonicalises the city.
- `tags`: short facts that rule labels read. Map structured fields to these canonical tags so existing rules fire:
  - work mode: `fully remote` | `hybrid work` | `on-site`
  - contract: `contractor` (contract/freelance/B2B), nothing for plain full-time
  - keep the source's own employment-type/location strings as extra tags.
- `raw`: the original item (trim huge fields), plus `detailError` (string) when a per-offer request failed.

## Tests (keep them few)
- Parse a saved real response fixture → exact expected fields for 1–2 items.
- One test per non-obvious mapping (e.g. remote → `fully remote` tag).
- No tests that restate defaults, constants or wiring. Test LOC for the source <= its src LOC.

## Registry
`src/cli/collect.ts` `COLLECTORS` gets exactly one entry per source (+ its import). This is the only shared-file edit allowed for a collector task; the lead resolves the resulting merge conflicts.

## Smoke
1. `HTTP_MODE=record HTTP_CACHE_DIR=/Users/filip/projects/job-agent/data/http-cache DB_PATH=data/dev.db bun run collect --source <source> --limit 5`
2. The same with `HTTP_MODE=replay`: same counts, no network.
Check the source's robots.txt first; the client matches plain prefixes only, so wildcard rules (`/*/x`, `*?*`) must be checked by hand.
