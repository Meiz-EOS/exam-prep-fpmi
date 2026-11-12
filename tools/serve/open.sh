#!/bin/sh
# Start the local server if needed and open the tab (docs/architecture/07-standalone.md#launch).
# Usage: tools/serve/open.sh [--stop]
# Env: ZACHETKA_PORT (4317), ZACHETKA_NODE (node), ZACHETKA_DATA (data root), ZACHETKA_NO_BROWSER=1 (print the URL instead).
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd) || exit 1
PORT=${ZACHETKA_PORT:-4317}
NODE=${ZACHETKA_NODE:-node}
URL="http://127.0.0.1:$PORT/"
STATE=${XDG_CACHE_HOME:-$HOME/.cache}/zachetka
LOG=$STATE/serve-$PORT.log
PIDFILE=$STATE/serve-$PORT.pid
mkdir -p "$STATE"

health() { curl -fsS --max-time 1 "${URL}api/health" >/dev/null 2>&1; }

if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; then echo "stopped"; else echo "not running"; fi
  rm -f "$PIDFILE"
  exit 0
fi

if ! health; then
  setsid nohup "$NODE" "$REPO/tools/serve/server.ts" --port "$PORT" >>"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  i=0
  until health; do
    i=$((i + 1))
    if [ "$i" -ge 25 ]; then
      msg="Сервер не запустился, журнал: $LOG"
      command -v notify-send >/dev/null && notify-send "Зачётка" "$msg"
      echo "$msg" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

if [ "${ZACHETKA_NO_BROWSER:-}" = "1" ]; then echo "$URL"; else xdg-open "$URL" >/dev/null 2>&1 & fi
