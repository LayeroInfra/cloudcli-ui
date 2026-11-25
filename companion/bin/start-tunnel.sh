#!/bin/bash
# SSH только Mac→VM. UI и gRPC сборок на localhost Mac.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/ssh-tunnel.sh
source "$ROOT/bin/lib/ssh-tunnel.sh"
# shellcheck source=lib/identity.sh
source "$ROOT/bin/lib/identity.sh"

LOG_DIR="${HOME}/.local/state/cloudcli-companion"
PID_FILE="$LOG_DIR/tunnel.pid"
mkdir -p "$LOG_DIR"

require_identity
WORKSPACE_HOST="$(identity_workspace_host)"
if ! ip="$(resolve_workspace_ip "$WORKSPACE_HOST")"; then
  echo "не резолвится ${WORKSPACE_HOST} (нужен DNS A/AAAA на IP VM)" >&2
  exit 1
fi

SSH_DIR="$(companion_ssh_dir)"
previous_ip="$(cat "$SSH_DIR/resolved-ip" 2>/dev/null || true)"
previous_host="$(cat "$SSH_DIR/workspace-host" 2>/dev/null || true)"
previous_user="$(cat "$SSH_DIR/workspace-user" 2>/dev/null || true)"
ensure_companion_ssh "$ROOT" "$WORKSPACE_HOST" "$ip"
ssh_user="$(awk '$1 == "User" { print $2; exit }' "$SSH_DIR/config")"

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
    if [ "$previous_ip" = "$ip" ] && [ "$previous_host" = "$WORKSPACE_HOST" ] && [ "$previous_user" = "$ssh_user" ]; then
      echo "туннель уже работает pid=$pid"
      exit 0
    fi
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
  rm -f "$PID_FILE"
fi
rm -f "$SSH_DIR/resolved-ip" "$SSH_DIR/workspace-host" "$SSH_DIR/workspace-user"

SSH_CONFIG="$(companion_ssh_dir)/config"
ssh -F "$SSH_CONFIG" \
  -nNT \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:19443:127.0.0.1:9443 \
  -L 127.0.0.1:19000:127.0.0.1:9000 \
  layero-workspace \
  >>"$LOG_DIR/tunnel.log" 2>&1 &
echo $! > "$PID_FILE"
sleep 1
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "туннель не поднялся, см. $LOG_DIR/tunnel.log" >&2
  exit 1
fi
(
  umask 077
  printf '%s\n' "$ip" >"$SSH_DIR/resolved-ip"
  printf '%s\n' "$WORKSPACE_HOST" >"$SSH_DIR/workspace-host"
  printf '%s\n' "$ssh_user" >"$SSH_DIR/workspace-user"
)
echo "туннель pid=$(cat "$PID_FILE") → 127.0.0.1:19443 (UI), 127.0.0.1:19000 (сборки) host=${WORKSPACE_HOST}"
