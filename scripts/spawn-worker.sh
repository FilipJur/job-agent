#!/bin/sh
# Open an omp worker session in a Ghostty pane. Usage: scripts/spawn-worker.sh <dir> <prompt-file> [model]
# The first worker opens a new "workers" window; later ones split it (right, down, right). Max 4.
# [model] defaults to the `worker` role from .omp/config.yml (the session default is the lead's Opus);
# pass `ui` for the UI role, or a concrete model only when the user asks for one (docs/LEAD.md).
# Task id = prompt file name without .md. Deletes a stale report for that id and writes the run record
# .lead/runs/<task>.env read by scripts/watch-workers.sh and scripts/audit-worker.ts.
# Prints the pane's terminal id. Docs: docs/LEAD.md.
set -eu
[ $# -eq 2 ] || [ $# -eq 3 ] || { echo "usage: $0 <dir> <prompt-file> [model]" >&2; exit 2; }
repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(cd "$1" && pwd)
prompt=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
[ -f "$prompt" ] || { echo "no prompt file: $prompt" >&2; exit 2; }
task=$(basename "$prompt" .md)
report="$repo/.lead/reports/$task.md"
run="$repo/.lead/runs/$task.env"

# Prompt contract (docs/LEAD.md "Prompt template"): file set, branch and the exact report line.
grep -q "Files you may change:" "$prompt" || { echo "prompt lacks 'Files you may change:'" >&2; exit 2; }
grep -qF "$report" "$prompt" || { echo "prompt must name the report path $report" >&2; exit 2; }
branch=$(sed -n 's/.*branch `\([^`]*\)`.*/\1/p' "$prompt" | head -n 1)
[ -n "$branch" ] || { echo "prompt lacks the branch as: branch \`name\`" >&2; exit 2; }
[ -e "$run" ] && { echo "task id $task was already spawned ($run); use a new prompt name" >&2; exit 2; }

rm -f "$report"
mkdir -p "$repo/.lead/runs" "$repo/.lead/reports"
state="${TMPDIR:-/tmp}/job-agent-workers-window"
# Tier 2 model: a role name (worker/ui) resolves through modelRoles in the worker's directory.
model=${3:-worker}
case "$model" in
  */*) ;;
  *) model=$(cd "$dir" && omp config get modelRoles | bun -e "console.log(JSON.parse(await Bun.stdin.text())['$model'] ?? '')") ;;
esac
[ -n "$model" ] || { echo "no model for role ${3:-worker} in modelRoles" >&2; exit 2; }
model_flag="--model=$model "
window=$(cat "$state" 2>/dev/null || true)
spawned_at=$(date +%s)

term_id=$(osascript - "$dir" "$prompt" "$window" "$state" "$model_flag" <<'EOF'
on run argv
  set {d, p, winId, stateFile, modelFlag} to argv
  tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to d
    if winId is not "" and (exists window id winId) then
      set w to window id winId
      set n to count of terminals of w
      if n ≥ 4 then error "workers window already has 4 panes; close finished workers first"
      set last_ to terminal n of w
      if n mod 2 is 1 then
        set t to split last_ direction right with configuration cfg
      else
        set t to split last_ direction down with configuration cfg
      end if
    else
      set w to new window with configuration cfg
      set t to terminal 1 of selected tab of w
      do shell script "printf %s " & quoted form of (id of w as text) & " > " & quoted form of stateFile
    end if
    input text "omp " & modelFlag & "@" & quoted form of p to t
    send key "enter" to t
    return id of t
  end tell
end run
EOF
)

cat > "$run" <<EOF
TASK=$task
TERM_ID=$term_id
DIR=$dir
PROMPT=$prompt
REPORT=$report
BRANCH=$branch
MODEL=$model
SPAWNED_AT=$spawned_at
BASE=$(git -C "$dir" rev-parse HEAD)
EOF
echo "$term_id"
