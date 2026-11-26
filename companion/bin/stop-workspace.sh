#!/bin/bash
# Stop every Layero Workspace process owned by this Mac session.
set -euo pipefail
LOG_DIR="${HOME}/.local/state/cloudcli-companion"
mkdir -p "$LOG_DIR"

uid="$(id -u)"

# Build agent (launchd)
launchctl bootout "gui/${uid}/ai.layero.cloudcli-build-agent" 2>/dev/null || true

# Companion / sign-in / status
if [ -f "$LOG_DIR/companion.pid" ]; then
  kill "$(cat "$LOG_DIR/companion.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/companion.pid"
fi
rm -f "$LOG_DIR/ready.json"
pkill -f "${HOME}/.local/share/cloudcli-companion/bin/start-companion.sh" 2>/dev/null || true
pkill -f '/cloudcli-companion/bin/start-companion.sh' 2>/dev/null || true
pkill -f 'signin-window.py' 2>/dev/null || true
if [ -f "$LOG_DIR/status-server.pid" ]; then
  kill "$(cat "$LOG_DIR/status-server.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/status-server.pid"
fi
# status-server python child
pkill -f 'cloudcli-companion.*status-server' 2>/dev/null || true
pkill -f "PORT=${WORKSPACE_STATUS_PORT:-19100}" 2>/dev/null || true

# SSH tunnel
if [ -f "$LOG_DIR/tunnel.pid" ]; then
  kill "$(cat "$LOG_DIR/tunnel.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/tunnel.pid"
fi
pkill -f 'ssh .*-L 127.0.0.1:19443:127.0.0.1:9443' 2>/dev/null || true
if [ -f "$LOG_DIR/preview-tunnel.pid" ]; then
  kill "$(cat "$LOG_DIR/preview-tunnel.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/preview-tunnel.pid"
fi
rm -f "$LOG_DIR/preview-ports.json"

# Woodpecker agent / build helper
pkill -f "${HOME}/.local/share/cloudcli-companion/bin/woodpecker-agent" 2>/dev/null || true
pkill -f "${HOME}/.local/bin/cloudcli-build-agent" 2>/dev/null || true

{
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') stopped"
} >>"$LOG_DIR/stop.log"
