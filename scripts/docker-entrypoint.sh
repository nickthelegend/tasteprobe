#!/bin/sh
# Container entrypoint for the TasteProbe image. Makes sure TASTEPROBE_DATA_DIR is writable by the
# unprivileged "node" user, then runs the server as "node". Fails loudly instead of starting a server
# that cannot save audits.
set -eu
DATA_DIR="${TASTEPROBE_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  # Railway mounts volumes owned by root. With RAILWAY_RUN_UID=0 the container starts as root:
  # hand the volume to "node", keep it private (700), then drop privileges for the server.
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  exec su-exec node "$@"
fi

probe="$DATA_DIR/.write-check-$$"
if ! { mkdir -p "$DATA_DIR" && : > "$probe" && rm -f "$probe"; } 2>/dev/null; then
  echo "TasteProbe cannot start: TASTEPROBE_DATA_DIR=$DATA_DIR is not writable by uid $(id -u)." >&2
  echo "On Railway, set RAILWAY_RUN_UID=0 on the service: this entrypoint then chowns the volume and runs the server as the node user." >&2
  exit 1
fi
exec "$@"
