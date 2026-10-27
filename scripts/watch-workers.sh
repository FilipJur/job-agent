#!/bin/sh
# Watch spawned workers until each has a fresh report or needs the lead.
# Usage: scripts/watch-workers.sh [--long-min N] <task>...   (task = prompt name, see scripts/spawn-worker.sh)
# Prints one status line per minute. Exit 0: every task has a report newer than its spawn.
# Exit 3: a task needs attention (pane gone, idle without report, or running longer than --long-min, default 45).
# Run it as a background job from the lead session; do not poll by hand. Docs: docs/LEAD.md.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
long_min=45
if [ "${1:-}" = "--long-min" ]; then long_min=$2; shift 2; fi
[ $# -ge 1 ] || { echo "usage: $0 [--long-min N] <task>..." >&2; exit 2; }
for task in "$@"; do
  [ -f "$repo/.lead/runs/$task.env" ] || { echo "no run record for $task (spawn with scripts/spawn-worker.sh)" >&2; exit 2; }
done

title() {
  osascript -e 'on run a' -e 'tell application "Ghostty" to return name of terminal id (item 1 of a)' -e 'end run' "$1" 2>/dev/null || echo GONE
}

idle_seen=""
while :; do
  now=$(date +%s)
  line=$(date +%H:%M)
  done_all=1
  for task in "$@"; do
    # shellcheck disable=SC1090
    . "$repo/.lead/runs/$task.env"
    if [ -f "$REPORT" ] && [ "$(stat -f %m "$REPORT")" -ge "$SPAWNED_AT" ]; then
      line="$line $task:DONE"
      continue
    fi
    done_all=0
    t=$(title "$TERM_ID")
    mins=$(( (now - SPAWNED_AT) / 60 ))
    line="$line $task:${mins}m"
    case "$t" in
      GONE) echo "$line"; echo "ATTENTION $task: pane closed without a report"; exit 3 ;;
      *"π >"*)
        # Idle twice in a row: the worker stopped without a report (finished silently or asks a question).
        case " $idle_seen " in
          *" $task "*) echo "$line"; echo "ATTENTION $task: idle without report ($t)"; exit 3 ;;
        esac
        idle_seen="$idle_seen $task" ;;
      *) idle_seen=$(echo "$idle_seen" | tr ' ' '\n' | grep -vx "$task" | tr '\n' ' ' || true) ;;
    esac
    if [ "$mins" -ge "$long_min" ]; then
      echo "$line"; echo "ATTENTION $task: running ${mins}m (>= ${long_min}m); audit the transcript"; exit 3
    fi
  done
  echo "$line"
  [ "$done_all" -eq 1 ] && exit 0
  sleep 60
done
