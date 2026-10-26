#!/bin/sh
# Open an omp worker session in a Ghostty pane. Usage: scripts/spawn-worker.sh <dir> <prompt-file>
# The first worker opens a new "workers" window; later ones split it (right, down, right). Max 4.
# Prints the pane's terminal id. Docs: docs/LEAD.md.
set -eu
[ $# -eq 2 ] || { echo "usage: $0 <dir> <prompt-file>" >&2; exit 2; }
dir=$(cd "$1" && pwd)
prompt=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
[ -f "$prompt" ] || { echo "no prompt file: $prompt" >&2; exit 2; }
state="${TMPDIR:-/tmp}/job-agent-workers-window"
window=$(cat "$state" 2>/dev/null || true)

osascript - "$dir" "$prompt" "$window" "$state" <<'EOF'
on run argv
  set {d, p, winId, stateFile} to argv
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
    input text "omp @" & quoted form of p to t
    send key "enter" to t
    return id of t
  end tell
end run
EOF
