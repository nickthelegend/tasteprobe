#!/usr/bin/env bash
# Starts the real TasteProbe targets for the browser E2E run, bound to 127.0.0.1, each with an
# EMPTY environment (env -i: only PATH and HOME plus the variables named below), so no provider
# key can leak in and every key is honestly missing.
#   3101  next dev                                   (npm run dev, the README's local path), empty store
#   3102  node server.js from .next/standalone        (started through scripts/docker-entrypoint.sh,
#         assembled exactly like the Dockerfile: standalone + .next/static), empty store, with
#         TASTEPROBE_RUNS_OPEN=1 (a private server; without it or a run token, production refuses runs)
#   3103  the same standalone build configured as a public demo: TASTEPROBE_RUN_TOKEN (a random
#         test token written to e2e/.run/run-token, mode 600), TASTEPROBE_MAX_PERSONAS=24, agent
#         caps of 100 assistant calls and 2 copies (below the UI's defaults of 120 and 3), and
#         TASTEPROBE_FEATURED_AUDIT_ID, with a test-only store seeded by e2e/seed.mjs from the
#         SYNTHETIC fixture (14 audits, every name marked synthetic). Still no provider key.
# Ports: TASTEPROBE_E2E_PORT_DEV / _STANDALONE / _PUBLIC override 3101 / 3102 / 3103 (the
# Playwright config reads the same variables).
# Needs `npm run build` first. PIDs go to e2e/.run/pids; `e2e/stack.sh stop` kills them by PID.
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
DEV_PORT=${TASTEPROBE_E2E_PORT_DEV:-3101}
STANDALONE_PORT=${TASTEPROBE_E2E_PORT_STANDALONE:-3102}
PUBLIC_PORT=${TASTEPROBE_E2E_PORT_PUBLIC:-3103}
for port in $DEV_PORT $STANDALONE_PORT $PUBLIC_PORT; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "error: port $port is already in use (set TASTEPROBE_E2E_PORT_* to pick others)" >&2; exit 1; fi
done

rm -rf "$RUN"; mkdir -p "$RUN/data-dev" "$RUN/data-standalone" "$RUN/data-public"; chmod 700 "$RUN"
( umask 077; node -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))" > "$RUN/run-token" )
node e2e/seed.mjs "$RUN/data-public"
# Same layout as the Dockerfile's run stage.
cp -R .next/standalone "$RUN/standalone"
cp -R .next/static "$RUN/standalone/.next/static"

start() { # name cmd...
  local name=$1; shift
  "$@" > "$RUN/$name.log" 2>&1 &
  echo "$name $!" >> "$RUN/pids"
}

start dev env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 TASTEPROBE_DATA_DIR="$PWD/$RUN/data-dev" \
  node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p "$DEV_PORT"
start standalone env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT="$STANDALONE_PORT" \
  TASTEPROBE_RUNS_OPEN=1 TASTEPROBE_DATA_DIR="$PWD/$RUN/data-standalone" scripts/docker-entrypoint.sh node "$RUN/standalone/server.js"
start public env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT="$PUBLIC_PORT" \
  TASTEPROBE_DATA_DIR="$PWD/$RUN/data-public" TASTEPROBE_RUN_TOKEN="$(cat "$RUN/run-token")" TASTEPROBE_MAX_PERSONAS=24 \
  TASTEPROBE_AGENT_MAX_CALLS=100 TASTEPROBE_AGENT_MAX_TRIES=2 \
  TASTEPROBE_FEATURED_AUDIT_ID=00000000-0000-4000-8000-000000000001 scripts/docker-entrypoint.sh node "$RUN/standalone/server.js"

wait_http() { for _ in $(seq 1 200); do curl -fs -o /dev/null "$1" && return 0; sleep 0.5; done; echo "error: $1 never came up" >&2; return 1; }
wait_http "http://127.0.0.1:$STANDALONE_PORT/api/status"
wait_http "http://127.0.0.1:$PUBLIC_PORT/api/status"
wait_http "http://127.0.0.1:$DEV_PORT/api/status"
# Compile the dev routes once so the first test doesn't time out on a cold compile.
for path in / /audits/warmup/report /api/audits /api/audits/warmup; do curl -fs -o /dev/null "http://127.0.0.1:$DEV_PORT$path" || true; done

echo "stack up"
cat "$RUN/pids"
