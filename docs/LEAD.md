# Lead guide: spawning workers

Read this before dispatching any worker. The lead spawns and watches workers itself; the user no longer pastes prompts. Rules for where workers run, file sets and merging stay in `docs/PARALLEL.md`.

## Models (strict)
`.omp/config.yml` (committed) sets the models for every omp session started in this repo or a worktree of it:

| Who | Model | Fallback |
|---|---|---|
| Worker session | `opencode-go/muse-spark-1.3-contributor` | `anthropic/claude-sonnet-5-5` |
| Subagents (`task`, `scout`, `sonic`, `reviewer`, …) | `opencode-go/deepseek-v4.1-flash` | `anthropic/claude-haiku-5-5` |

The lead session runs Opus 5.5 by the user's decision; the policy above applies to workers and subagents. Read-only research goes to `scout`, reviews to `reviewer` (both on the subagent model), not to the generic `task` agent.

- Do not pass `--model` to workers and do not switch models in a worker session, unless the user asks for a specific model for a task: then pass it as the third argument of `scripts/spawn-worker.sh`.
- The file applies only when omp starts in a directory that contains it. A worktree created from `main` has it. A directory outside the repo does not.
- Check the policy from the working directory with `omp config get modelRoles`.

## Spawn loop
1. **Plan:** pick the place and the branch per `docs/PARALLEL.md` (one worker: main checkout on its own branch; 2–4 concurrent: one worktree each). Create them before spawning. Shared types/schema ("the contract") are a short worker task merged to `main` first; parallel workers start from that `main`.
2. **Prompt:** write `.lead/prompts/<task>.md` from the template below (gitignored, lives in the main checkout). The task id is the file name and must be new: never reuse a task id, branch name or report path from an earlier run (add `-2`, `-fix` …).
   - **Subagents inside a worker:** a prompt line starting with `orchestrate:` makes the worker split the task across subagents. Use it only when the task has 2+ substantial parts with disjoint files and a boundary fixed in the prompt (e.g. API server vs. React app). Do not use it for core files (`src/db.ts`, `src/types.ts`, `src/pipeline.ts`, `src/repo.ts`), for small tasks or for fix rounds. Name which part owns shared files (`package.json`, `bun.lock`, `tsconfig.json`); the worker verifies once after all parts finish.
3. **Spawn:** `scripts/spawn-worker.sh <dir> <prompt-file> [model]`. It checks the prompt (file set, branch, report line), refuses a task id that already ran, deletes a stale report, writes the run record `.lead/runs/<task>.env` (pane id, branch, base commit, spawn time) and prints the pane id.
   - The first worker opens a separate "workers" window. Later workers split it, up to 4 panes.
   - The pane runs `omp @<prompt-file>` interactively, so the user can watch it and type into it.
4. **Wait:** run `scripts/watch-workers.sh <task>...` as one background job and wait for it; never poll by hand. Exit 0 = every task has a report newer than its spawn. Exit 3 = a task needs the lead:
   - *pane closed* or *idle without report*: read the end of the transcript (step 5 script lists it); if the worker asks a question only the user can answer, tell the user which pane; otherwise steer it (see "Steering").
   - *running ≥ 45 min*: run the audit now; if the transcript shows a loop or scope drift, steer; else restart the watcher with `--long-min <higher>`.
5. **Audit:** `bun scripts/audit-worker.ts <task>`. It checks the diff against the prompt's file set, uncommitted work, commits, test vs src LOC, report freshness, and the transcript (`~/.omp/agent/sessions/<cwd>/*.jsonl`): waits (`sleep ≥ 10`), commands in other worktrees, `git push/merge/rebase/stash/reset --hard`, production DB access, edits outside the set, tool errors, duration, models and cost. Every red flag is explained in the review or fixed before merge.
6. **Review:** read the report, then re-run the checks yourself (`bun test`, `bun run typecheck`, `bun run web:build`); numbers in a report are claims, not evidence. Then a fresh-eyes review: `task` with agent `reviewer`, context = the prompt file + `git diff <base>..<branch>`, instruction "check every requirement of the prompt is met and the listed acceptance holds; report only gaps that affect correctness; skip style". Fix rounds go to the same branch.
7. **Integrate** per `docs/PARALLEL.md`, then **close** the pane. The session stays in omp history.

## Prompt template
Every worker prompt contains, in this order (the spawn script enforces the marked lines):
1. Place and branch: ``Place: <main checkout | worktree path>, branch `<branch>` (created by the lead).`` *(enforced)*
2. ``Files you may change: `path`, `dir/**` … Not allowed: … Anything else: stop and report.`` *(enforced; the audit reads the backticked paths up to "Not allowed")*
3. Why: the user's intent in his words, and the facts the worker cannot find in the repo.
4. Change: numbered items, one commit each.
5. Tests: behaviour only, test LOC added ≤ src LOC added.
6. Acceptance: exact commands; for a change to an external API or model (LLM, HTTP source), a live smoke of 1–2 real calls before the report; for UI, screenshots.
7. Fixed worker rules, copy verbatim:
   `Never wait for, poll or read other worktrees or sessions. If something another worker owns is missing, build against the contract in this prompt (a local stub or type) and say so in the report. Never merge, push, rebase or stash. Do not touch data/jobs.db. Paste the commands you ran and their real output into the report.`
8. The last line: `When done, write your report to /Users/filip/projects/job-agent/.lead/reports/<task>.md (create the directory if missing), then stop.` *(enforced)*

## Steering
A running worker reads typed text like a user message. Send one short instruction when the watcher or audit shows a loop, scope drift or a wrong assumption; say it comes from the lead. Do not send more than one message per problem; if it does not help, stop the worker and spawn a fix task.

```sh
osascript -e 'on run a' -e 'tell application "Ghostty"' -e 'input text (item 2 of a) to terminal id (item 1 of a)' -e 'send key "enter" to terminal id (item 1 of a)' -e 'end tell' -e 'end run' <id> "Lead: <instruction>"
```

## Pane commands
Pass the terminal id as an argument. An id written inline in the script text fails with a syntax error.

```sh
# state (title)
osascript -e 'on run a' -e 'tell application "Ghostty" to return name of terminal id (item 1 of a)' -e 'end run' <id>
# close
osascript -e 'on run a' -e 'tell application "Ghostty" to close terminal id (item 1 of a)' -e 'end run' <id>
```

## Limits
- **Max 4 workers at once.** The script refuses a fifth pane, and review cannot keep up with more anyway.
- **No new tabs.** Ghostty 1.3.1 rejects `new tab` over AppleScript (error -1708), so the script uses windows and splits only.
- **Blind panes.** AppleScript cannot read a pane's output. Use the report file, `scripts/watch-workers.sh` and the transcript via `scripts/audit-worker.ts`.
- **First run asks for permission.** macOS may ask once to allow the terminal to control Ghostty (Automation permission).
