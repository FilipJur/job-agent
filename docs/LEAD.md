# Lead guide: spawning workers

Read this before dispatching any worker. The lead spawns and watches workers itself; the user no longer pastes prompts. Rules for where workers run, file sets and merging stay in `docs/PARALLEL.md`.

## Models (strict)
`.omp/config.yml` (committed) sets the models for every omp session started in this repo or a worktree of it:

| Who | Model | Fallback |
|---|---|---|
| Worker session | `opencode-go/muse-spark-1.3-contributor` | `anthropic/claude-sonnet-5-5` |
| Subagents (`task`, `scout`, `sonic`, `reviewer`, …) | `opencode-go/deepseek-v4.1-flash` | `anthropic/claude-haiku-5-5` |

The two lead sessions (lead, creep reviewer) run Opus 5.5 by the user's decision and are not restarted; the policy above applies to workers only.

- Do not pass `--model` to workers and do not switch models in a worker session.
- The file applies only when omp starts in a directory that contains it. A worktree created from `main` has it. A directory outside the repo does not.
- Check the policy from the working directory with `omp config get modelRoles`.

## Spawn loop
1. **Plan:** pick the place and the branch per `docs/PARALLEL.md` (one worker: main checkout on its own branch; 2–4 concurrent: one worktree each). Create them before spawning.
2. **Prompt:** write `../job-agent-prompts/<slice>-<task>.md`. It must start with the place, the branch and "Files you may change: …". It must end with:
   `When done, write your report to /Users/filip/projects/job-agent-prompts/reports/<slice>-<task>.md (create the directory if missing), then stop.`
3. **Spawn:** run `scripts/spawn-worker.sh <dir> <prompt-file>`. It prints the pane's terminal id; note the id per task.
   - The first worker opens a separate "workers" window. Later workers split it, up to 4 panes.
   - The pane runs `omp @<prompt-file>` interactively, so the user can watch it and type into it.
4. **Wait:** the report file is the done signal. Check with `ls ../job-agent-prompts/reports/`; do not busy-poll, about once a minute is enough.
   - The pane title shows state: `π ⠙ …` means working, `π > …` means idle.
   - A pane that is idle but has no report is waiting for an answer. Tell the user which pane it is; do not guess the answer.
5. **Review:** read the report, then integrate per `docs/PARALLEL.md` (diff, tests on the merged result, one merge at a time). Send the branch to the creep reviewer before merging.
6. **Close:** close the pane once its report has been read. The session stays in omp history.

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
- **Blind panes.** AppleScript cannot read a pane's output. Use the report file, or the worker's transcript from omp session history.
- **First run asks for permission.** macOS may ask once to allow the terminal to control Ghostty (Automation permission).
- **Sending text to a running worker.** `input text` reaches it like typed text. Do this only when the user asks; normal steering goes through the prompt file.
