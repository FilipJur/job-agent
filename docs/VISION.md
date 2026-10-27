# Vision

Reference for agents working on this repo. AGENTS.md has the rules; this file explains what we are building and why. Do not implement anything from "Later" unless a task prompt asks for it.

## Problem
One candidate (Filip, Olomouc, CZ) wants better-paid work than his current agency subcontract. Relevant offers are scattered across many sources, most are noise, and Olomouc itself has very few.

## Goal
Every morning, show only the offers worth acting on, grouped as:
1. **Agentury** — Olomouc-area agencies he could subcontract for on IČO. Highest priority (lowest friction).
2. **Kontrakty** — IČO / freelance / DPP-DPČ work, remote CZ/EU or local.
3. **HPP** — employment, preferably Olomouc (onsite/hybrid) or remote from CZ.

Success = he spends a few minutes a day, marks 👍/👎, and contacts the good ones himself.

## Candidate profile (scoring target)
- Strong: AI-assisted / agentic development (coding agents, MCP, custom agents/skills, model routing, visual verification), WordPress/WooCommerce (PHP, child themes, ACF), React/TypeScript/Vite/Tailwind, Astro, Supabase/Netlify, deploys, PHP/WP upgrades, client communication.
- Weak: Python, tests/CI, public GitHub, formal seniority.
- Excluded: Nette/Latte, teaching/lecturing, sales roles.
- Primary fit: AI-first roles. Secondary: React/TS or WP roles.

## Non-goals
- No auto-apply, form filling, or messages sent on his behalf. Ever.
- No mass scraping: one run per source per day, robots.txt respected.
- Not a general job board for other users.

## Architecture
```
collectors (deterministic) → normalize → dedup → rule labels → LLM score → SQLite
                                                                   ↓
                                             web UI (HPP / Kontrakty / Agentury) → feedback → profile tuning
```
- **Collectors**: one isolated module per source; failure is recorded, never aborts the run. No LLM inside collectors.
- **Labels**: multi-valued and independent. Rules first; LLM only for labels the text cannot decide.
  - form: `hpp`, `ico`, `freelance`, `dpp-dpc`
  - mode: `remote`, `hybrid`, `onsite`
  - place: `olomouc`, `okoli-olomouce`, `praha`, `remote-cz`, `remote-eu`
  - content: `ai-first`, `react-ts`, `wordpress`
  - flag: `excluded`
- **Scoring**: cheap model via OpenCode Go (OpenAI-compatible, `muse-spark-1.3-contributor`), JSON-schema output: score 0–10, one-line reason, what the candidate lacks. Model choice is decided by agreement with his labels, not by guess.
- **Agencies**: separate entity (contact, pipeline status, notes, last contact). Offers posted by an agency link to it. Refreshed monthly, not daily.
- **Feedback**: 👍/👎 + reason per offer; weekly proposal to update `profile.md`, applied only after his approval.

## UI
React + Vite, served by Bun. Three tabs: HPP, Kontrakty, Agentury. Offers sorted by score, filters (new, remote, Olomouc), reason + gaps, link, actions (👍, 👎, responded, hide). Agencies as a status table. Mobile-friendly. Animations (Framer Motion) only after v0.

## Sources
Measured on 2026-10-26 (relevant hits per query):

| Keep | Why |
|---|---|
| jobs.cz (national, AI/React/TS keywords) | main CZ source, ~10–15 relevant per query |
| startupjobs.cz (sitemap + JSON-LD detail) | highest AI-first density |
| Workable API (`location=Czechia`, precise queries) | structured, remote filter |
| Ashby per company (e.g. apify) | tracked companies only |
| HN "Who is hiring" via Algolia | monthly, best remote-EU AI roles |

Dropped: Upwork (robots.txt disallows `/nx/` search and `/jobs/rss`), prace.cz (duplicates jobs.cz), Working Nomads (unfilterable), WWR (mostly US-only), Wellfound (0 for CZ, not machine-readable), Webtrh poptávky (mostly public tenders), junior.guru (junior-only).

How to add a source: `docs/COLLECTORS.md`.

Agencies: discovered once via firmy.cz "Webdesign" (okres Olomouc) + web search; 21 seeded.

## Deployment
Old MacBook (M1, 8 GB) at home, OrbStack + docker compose: one container for the daily collect/score job, one for the web. Access via LAN or Tailscale; no public exposure, no auth. Secrets only in `.env`.

## Roadmap
- **v0** ✅: (1) scaffold + jobs.cz + rule labels · (1.5) dev mode: HTTP record/replay cache, skip known details, `--source`/`--limit` · (1.6) cleanup: trim CLI, retry failed details · (2) startupjobs, Workable, Ashby, HN collectors · (3) LLM scoring + `profile.md` · (4) web UI + agencies seed · (5) docker compose + daily schedule (`docs/DEPLOY.md`).
- **v0.1** ✅: profile as user data in `data/profile.md` + Profil tab · scoring concurrency 4 · agency contact forms.
- **Later**: Jev typed judge to validate scoring against his labels; Framer Motion polish; morning notification; rate statistics from budgets/salaries; draft replies from verified `facts.md` only.

## Decisions log
- Sources whose robots.txt disallows the needed paths are dropped, not worked around (Upwork).
- Research-only agent; human sends everything (auto-apply risks blacklisting and fabricated claims).
- Agencies before HPP: subcontracting is his current model and fastest path to better rates.
- Deterministic collectors + rules before LLM: cheaper, testable, debuggable.
- `hpp` means a contract type, not workload: "full-time" alone does not imply `hpp`.
- jobs.cz city search uses a 50 km radius; location comes from the offer detail.
- Ashby: a remote role whose UTC/GMT band covers +1 or +2 (CET/CEST) counts as EU-reachable.
- The profile belongs to the user (`data/profile.md`); agents write it only when asked; an empty profile is rejected.

## Open questions
- jobs.cz brand-widget offers (~42 %) expose only a short og:description; is there an allowed full-text source?
- How the 👍/👎 feedback turns into profile changes in practice (thresholds, cadence).
- `deploy/cz.jobagent.daily.plist` calls `/usr/local/bin/docker`; check `which docker` on the target Mac (OrbStack) before installing.
