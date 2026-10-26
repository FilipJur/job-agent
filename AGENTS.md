# AGENTS.md

Personal job-search agent: collects job offers daily, labels and scores them against one candidate profile, serves a small web UI. Runs on a home Mac (M1, 8 GB) via OrbStack/Docker.
Goals, scope, sources and roadmap: `docs/VISION.md`. Read it before starting a slice.

## Stack
- Bun + TypeScript (strict), SQLite via `bun:sqlite`, tests via `bun test`.
- Web: React + Vite. No UI animation libraries until v0 is done.
- LLM: OpenCode Go, OpenAI-compatible API, model `mimo-v2.6-flash`. Key from env `OPENCODE_GO_API_KEY`.

## Commands
- `bun install`
- `bun test` — must pass before you report done.
- `bun run typecheck` — must pass before you report done.

## Architecture decisions
- Pipeline: collect → normalize → dedup → rule labels → LLM score → store. Each collector is an isolated module; one failing source must not stop the run, and the failure is recorded.
- Labels are multi-valued and independent (an offer can be both `hpp` and `ico`). Rules set labels first; LLM only fills labels rules cannot decide.
- Collectors are deterministic and never call the LLM.
- Agencies are a separate entity (contact + pipeline status), not a label on offers.
- Never auto-apply, submit forms, or send messages on the user's behalf.

## Gotchas
- jobs.cz `/prace/<city>/` applies a 50 km radius; verify the real location from the offer detail.
- Strip `utm_*`, `gclid`, `_gl` from URLs before dedup.
- Respect robots.txt; at most one run per day per source.
- Secrets live only in `.env` (gitignored). Never commit, log, or print keys.

## Workflow
- Work on the slice given in the task prompt only; do not start the next slice.
- Work only in the worktree and branch named in the prompt; change only the files the prompt allows. Never merge, rebase, or touch `main`. Rules for parallel sessions: `docs/PARALLEL.md`.
- Commit locally in atomic commits. Never push.
- Finish with a report: what changed (files), commands run with their real output, known gaps.
