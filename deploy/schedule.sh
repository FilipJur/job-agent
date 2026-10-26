#!/bin/sh
# Install or remove the daily 06:30 run (launchd) for this checkout. Same on every Mac.
# Usage: deploy/schedule.sh install | uninstall | status
set -eu
label=cz.jobagent.daily
target="$HOME/Library/LaunchAgents/$label.plist"
repo=$(cd "$(dirname "$0")/.." && pwd)

case "${1:-}" in
  install)
    docker=$(command -v docker) || { echo "docker not found; install OrbStack first" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents"
    sed -e "s#__REPO__#$repo#g" -e "s#__DOCKER__#$docker#g" "$repo/deploy/$label.plist" > "$target"
    launchctl unload "$target" 2>/dev/null || true
    launchctl load "$target"
    echo "installed: daily at 06:30 (missed runs start at next wake); logs: $repo/data/daily.log"
    ;;
  uninstall)
    launchctl unload "$target" 2>/dev/null || true
    rm -f "$target"
    echo "removed"
    ;;
  status)
    launchctl list | grep "$label" || echo "not installed"
    ;;
  *)
    echo "usage: $0 install | uninstall | status" >&2
    exit 2
    ;;
esac
