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
CONTROL_SOCKET="$LOG_DIR/preview-ssh.sock"
mkdir -p "$LOG_DIR"

# Keep the existing default URL in the Browser panel. The native view checks
# the separate built-preview port before falling back to Vite dev.
SSH_CONFIG="$(companion_ssh_dir)/config"
PREVIEW_PORTS=(5174:5174 8080:8080 25174:25174)

if [ -S "$CONTROL_SOCKET" ]; then
  ssh -F "$SSH_CONFIG" -S "$CONTROL_SOCKET" -O exit layero-workspace >/dev/null 2>&1 || true
fi
if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] &&
     ps -p "$pid" -o command= 2>/dev/null | grep -Eq '(^|/)ssh .*layero-workspace'; then
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

dev_port=15173
dev_available=true
if /usr/sbin/lsof -nP -iTCP:"$dev_port" -sTCP:LISTEN >/dev/null 2>&1; then
  dev_available=false
fi
if [ "${#forwards[@]}" -eq 0 ] && [ "$dev_available" = false ]; then
  statuses+=('"15173":{"remote":5173,"state":"busy"}')
  write_status false
  exit 0
fi

# Keep the preview in its own SSH master. A port taken between the check
# and the bind should not drop the other preview forwards.
if ssh -F "$SSH_CONFIG" -f -nNT -M -S "$CONTROL_SOCKET" \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=no \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  ${forwards[@]+"${forwards[@]}"} \
  layero-workspace \
  >>"$LOG_DIR/preview-tunnel.log" 2>&1; then
  master="$(ssh -F "$SSH_CONFIG" -S "$CONTROL_SOCKET" -O check layero-workspace 2>&1 || true)"
  if [[ "$master" =~ pid=([0-9]+) ]]; then
    pid="${BASH_REMATCH[1]}"
    printf '%s\n' "$pid" >"$PID_FILE"

    dev_remote=5173
    if curl --noproxy '*' -fsS --max-time 2 "http://127.0.0.1:25174/__workspace_built_preview" |
       grep -Eq '^workspace-built-preview [0-9a-f]{40}$'; then
      dev_remote=5174
    fi

    dev_state=busy
    if [ "$dev_available" = true ]; then
      if ssh -F "$SSH_CONFIG" -S "$CONTROL_SOCKET" -O forward \
        -L "127.0.0.1:$dev_port:127.0.0.1:$dev_remote" layero-workspace \
        >>"$LOG_DIR/preview-tunnel.log" 2>&1; then
        dev_state=forwarded
      fi
    fi
    statuses+=("\"$dev_port\":{\"remote\":$dev_remote,\"state\":\"$dev_state\"}")
    write_status true
    echo "preview-туннель pid=$pid ${PREVIEW_PORTS[*]} $dev_port:$dev_remote"
    exit 0
  fi
fi

write_status false
echo "preview-туннель не поднялся, см. $LOG_DIR/preview-tunnel.log" >&2
exit 1
