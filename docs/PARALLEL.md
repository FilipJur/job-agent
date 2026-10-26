# Parallel work

Rules for running several agent sessions on this repo (Ghostty panes, one OMP session each).

## Roles
- **User**: approves plans and merges, watches worker panes, answers workers that ask. At most one prompt in flight per file set.
- **Lead** (exactly one): owns the slice plan and feature prompts, spawns and watches workers (`docs/LEAD.md`), owns the `main` branch (only the lead merges into it), resolves conflicts. Does not write feature code.
- **Creep reviewer** (exactly one): reviews finished branches only for scope, test and complexity creep. May write fix prompts limited to that lens; before dispatching, checks with the lead that no other prompt targets the same files. Keeps the lead's context clean; does not merge.
- **Worker**: implements one prompt on its own branch, in the place named in the prompt. Never commits to `main`, never touches other worktrees.

## Where work happens
Worktrees are for real concurrency only; a single worker does not need one.

| Situation | Where the worker works |
|---|---|
| One worker, lead not editing the repo meanwhile (lead's prompts live outside the repo) | Main checkout, branch `<slice>-<task>` from `main` |
| Fix round for a branch that is not merged yet | Same place, same branch |
| 2–4 workers at the same time, disjoint file sets | One worktree per worker, removed after merge |
| More than 4 at once | Don't: review cannot keep up |

Commands (lead):
- Single worker: `git switch -c <slice>-<task> main` in the main checkout; after merge `git switch main`.
- Concurrent worker: `git worktree add ../job-agent-wt-<task> -b <slice>-<task> main`, then `bun install` and copy `.env` if needed.

Reviewers only read (`git diff main...<branch>`, `git log`); no checkout, commit or edits.

## Before dispatching
1. Everything workers must read (AGENTS.md, docs/*) is committed on `main`. Worktrees only see committed files.
2. Each task has a file set written in its prompt ("Files you may change: …"). Concurrent tasks must have disjoint sets; tasks touching the same file run one after another. Name shared registries (e.g. `COLLECTORS` in `src/cli/collect.ts`) up front.
3. The prompt starts with the place (main checkout or worktree path), the branch and the file set.
4. Untracked state is per worktree: `node_modules`, `.env`, databases. Do not share `data/jobs.db`; use `DB_PATH=data/dev.db` or a `/tmp` DB.
5. HTTP responses are shared read-only through the main checkout's cache: `HTTP_MODE=replay HTTP_CACHE_DIR=/Users/filip/projects/job-agent/data/http-cache`.

## While working
- Workers commit locally on their branch, never push, never merge, never rebase other branches.
- No `git stash`: `refs/stash` is shared by every worktree of the repo.
- Live network runs (`bun run collect`) only when the prompt asks for it; jobs.cz allows one polite run per day, not one per worktree.
- A worker that needs a file outside its file set stops and reports instead of editing it.

## Integration (lead only)
1. Review each branch (`git diff main...<branch>`, run tests where it was built).
2. Merge into `main` one branch at a time, fast-forward or `--no-ff`; run `bun test && bun run typecheck` on the merged result after each merge (each branch passing alone does not prove the merge works).
3. Clean up: delete the merged branch (`git branch -d <slice>-<task>`) and its worktree if it had one (`git worktree remove ../job-agent-wt-<task>`).
4. Push `main` only after the user approves.

## When to parallelise
- Good: independent collectors (one directory each), UI vs. collector work, docs vs. code. Exception to disjoint files: each collector adds one `COLLECTORS` entry in `src/cli/collect.ts`; the lead resolves those conflicts at merge (`docs/COLLECTORS.md`).
- Bad: review fixes, schema changes, anything touching `src/db.ts`, `src/types.ts` or `src/pipeline.ts`; do these in one worker.
