# Parallel work

Rules for running several agent sessions on this repo at once (Ghostty panes, one OMP session each).

## Roles
- **User** (dispatcher): pastes prompts into worker sessions and relays reports. Only one prompt per slice is in flight at a time.
- **Lead** (exactly one): owns the slice plan and feature prompts, merges into `main`, resolves conflicts. Does not write feature code.
- **Creep reviewer** (exactly one): reviews finished branches only for scope, test and complexity creep. May write fix prompts limited to that lens; before dispatching, checks with the lead that no other prompt targets the same files. Keeps the lead's context clean; does not merge.
- **Worker**: implements one prompt in its own worktree and branch. Never touches `main` or other worktrees.

## Before spawning workers
1. Everything workers must read (AGENTS.md, docs/*) is committed on `main`. Worktrees only see committed files.
2. Each task has a disjoint file set, written in its prompt ("Files you may change: …"). Two tasks that touch the same file run sequentially, not in parallel.
3. One task = one worktree = one branch, created by the lead:
   `git worktree add ../job-agent-wt-<task> -b <slice>-<task> main`
4. Shared untracked state is not shared: each worktree needs its own `bun install` and `.env`; `data/` is per worktree.

## While working
- Workers commit locally on their branch, never push, never merge, never rebase other branches.
- Live network runs (`bun run collect`) only when the prompt asks for it; jobs.cz allows one polite run per day, not one per worktree.
- A worker that needs a file outside its file set stops and reports instead of editing it.

## Integration (lead only)
1. Review each branch (`git diff main...<branch>`, run tests in its worktree).
2. Merge into `main` one branch at a time, fast-forward or `--no-ff`; run `bun test && bun run typecheck` after each merge.
3. Remove finished worktrees: `git worktree remove ../job-agent-wt-<task>` and delete the branch.
4. Push `main` only after the user approves.

## When to parallelise
- Good: independent collectors (one directory each), UI vs. collector work, docs vs. code.
- Bad: review fixes, schema changes, anything touching `src/db.ts`, `src/types.ts` or `src/pipeline.ts` — do these in one worker.
