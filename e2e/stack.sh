#!/usr/bin/env bash
# Starts the two real TasteProbe targets for the browser E2E run, bound to 127.0.0.1, each with an
# EMPTY environment (env -i: only PATH and HOME), so no provider key can leak in and every key is
# honestly missing. Each target gets its own empty audit store; nothing is seeded.
#   3101  next dev                                   (npm run dev, the README's local path)
#   3102  node server.js from .next/standalone        (started through scripts/docker-entrypoint.sh,
#         assembled exactly like the Dockerfile: standalone + .next/static)
# Needs `npm run build` first for 3102. PIDs go to e2e/.run/pids; `e2e/stack.sh stop` kills them by PID.
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=e2e/.run

if [[ "${1:-}" == "stop" ]]; then
  [[ -f $RUN/pids ]] || { echo "no $RUN/pids"; exit 0; }
  while read -r name pid; do
    # next dev forks a worker; kill the children of our PID first, then the PID itself.
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill "$child" 2>/dev/null || true; done
    kill "$pid" 2>/dev/null && echo "killed $name ($pid)" || echo "$name ($pid) already gone"
  done < "$RUN/pids"
  rm -f "$RUN/pids"
  exit 0
fi

[[ -f .next/standalone/server.js ]] || { echo "error: .next/standalone/server.js missing; run: npm run build" >&2; exit 1; }
[[ -f $RUN/pids ]] && { echo "error: $RUN/pids exists; run e2e/stack.sh stop first" >&2; exit 1; }
for port in 3101 3102; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "error: port $port is already in use" >&2; exit 1; fi
done

rm -rf "$RUN"; mkdir -p "$RUN/data-dev" "$RUN/data-standalone"; chmod 700 "$RUN"
# Same layout as the Dockerfile's run stage.
cp -R .next/standalone "$RUN/standalone"
cp -R .next/static "$RUN/standalone/.next/static"

start() { # name cmd...
  local name=$1; shift
  "$@" > "$RUN/$name.log" 2>&1 &
  echo "$name $!" >> "$RUN/pids"
}

start dev env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 TASTEPROBE_DATA_DIR="$PWD/$RUN/data-dev" \
  node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3101
start standalone env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT=3102 \
  TASTEPROBE_DATA_DIR="$PWD/$RUN/data-standalone" scripts/docker-entrypoint.sh node "$RUN/standalone/server.js"

wait_http() { for _ in $(seq 1 200); do curl -fs -o /dev/null "$1" && return 0; sleep 0.5; done; echo "error: $1 never came up" >&2; return 1; }
wait_http http://127.0.0.1:3102/api/status
wait_http http://127.0.0.1:3101/api/status
# Compile the dev routes once so the first test doesn't time out on a cold compile.
for path in / /audits/warmup/report /api/audits; do curl -fs -o /dev/null "http://127.0.0.1:3101$path" || true; done

echo "stack up"
cat "$RUN/pids"
