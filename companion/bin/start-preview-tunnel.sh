#!/bin/bash
# Dev-server ports of the workspace on the Mac's localhost, for the Browser
# panel and Companion windows. Kept apart from start-tunnel.sh: a port that is
# busy on the Mac must not take the UI tunnel down with it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/ssh-tunnel.sh
source "$ROOT/bin/lib/ssh-tunnel.sh"

LOG_DIR="${HOME}/.local/state/cloudcli-companion"
PID_FILE="$LOG_DIR/preview-tunnel.pid"
STATUS_FILE="$LOG_DIR/preview-ports.json"
mkdir -p "$LOG_DIR"

# local:remote. 5173 inside the workspace is 15173 here, so a Vite server the
# Mac runs itself on 5173 keeps working. Mirror changes in
# src/modules/site-preview/SitePreviewPanel.tsx (TUNNELED_PORTS).
PREVIEW_PORTS=(5174:5174 8080:8080 15173:5173 8000:8000)

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.3
  fi
  rm -f "$PID_FILE"
fi

forwards=()
statuses=()
for pair in "${PREVIEW_PORTS[@]}"; do
  local_port="${pair%%:*}"
  remote_port="${pair##*:}"
  if /usr/sbin/lsof -nP -iTCP:"$local_port" -sTCP:LISTEN >/dev/null 2>&1; then
    statuses+=("\"$local_port\":{\"remote\":$remote_port,\"state\":\"busy\"}")
    echo "preview: порт $local_port на Mac занят, $remote_port с VM не пробрасываем" >&2
    continue
  fi
  forwards+=(-L "127.0.0.1:${local_port}:127.0.0.1:${remote_port}")
  statuses+=("\"$local_port\":{\"remote\":$remote_port,\"state\":\"forwarded\"}")
done

write_status() {
  (
    umask 077
    local IFS=,
    printf '{"alive":%s,"ports":{%s}}\n' "$1" "${statuses[*]}" >"$STATUS_FILE"
  )
}

if [ "${#forwards[@]}" -eq 0 ]; then
  write_status false
  exit 0
fi

# Without ExitOnForwardFailure a port taken between the check and the bind
# only costs that port.
ssh -F "$(companion_ssh_dir)/config" \
  -nNT \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=no \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  "${forwards[@]}" \
  layero-workspace \
  >>"$LOG_DIR/preview-tunnel.log" 2>&1 &
echo $! >"$PID_FILE"
sleep 1
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  write_status true
  echo "preview-туннель pid=$(cat "$PID_FILE") ${PREVIEW_PORTS[*]}"
else
  rm -f "$PID_FILE"
  write_status false
  echo "preview-туннель не поднялся, см. $LOG_DIR/preview-tunnel.log" >&2
  exit 1
fi
