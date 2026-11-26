#!/bin/bash
# Layero Workspace: one click → UI + SSH tunnel + build agent + status.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHARE="$HOME/.local/share/cloudcli-companion"
if [ "${0##*/}" = layero-workspace ]; then
  exec open -a "$HOME/Applications/Layero Workspace.app"
fi
if [ "$ROOT" != "$SHARE" ]; then
  SKIP_IDENTITY=1 "$ROOT/bin/install.sh"
  exec open -a "$HOME/Applications/Layero Workspace.app"
fi
if [ "${WORKSPACE_NATIVE_SESSION:-}" != 1 ]; then
  exec open -a "$HOME/Applications/Layero Workspace.app"
fi

# Keep the session handoff on the private pipe to the macOS host.
exec 3>&1 1>&2
LOG_DIR="$HOME/.local/state/cloudcli-companion"
# shellcheck source=lib/identity.sh
source "$ROOT/bin/lib/identity.sh"
# shellcheck source=lib/ssh-tunnel.sh
source "$ROOT/bin/lib/ssh-tunnel.sh"
# shellcheck source=lib/auth-login.sh
source "$ROOT/bin/lib/auth-login.sh"
# shellcheck source=lib/trust-cert.sh
source "$ROOT/bin/lib/trust-cert.sh"

mkdir -p "$LOG_DIR" "$HOME/.local/bin" "$HOME/.config/layero-workspace"
if ! IFS= read -r -t 10 cached_token; then
  echo "Companion did not receive startup data from the app" >&2
  exit 1
fi

load_session() {
  OWNER="$(identity_owner)"
  WORKSPACE_HOST="$(identity_workspace_host)"
  GATEWAY="$(identity_get gatewayUrl)"
  UI_URL="$(identity_get uiUrl)"
  UI_URL="${UI_URL:-https://127.0.0.1:19443}"
  CHECKOUT="$(identity_get checkout)"
}

STATUS_PORT="${WORKSPACE_STATUS_PORT:-19100}"

# Portable launchd plist (no hardcoded username)
PLIST_DST="$HOME/Library/LaunchAgents/ai.layero.cloudcli-build-agent.plist"
cat >"$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.layero.cloudcli-build-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${HOME}/.local/bin/cloudcli-build-agent</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.local/state/cloudcli-companion/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.local/state/cloudcli-companion/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
EOF

start_ui_tunnel() {
  if ! "$ROOT/bin/start-tunnel.sh"; then
    _alert "Не удалось поднять туннель к ${WORKSPACE_HOST}. Проверьте DNS и логи: ${LOG_DIR}/tunnel.log"
    return 1
  fi

  local attempt
  for ((attempt = 0; attempt < 15; attempt++)); do
    if curl --noproxy '*' -fsk -m2 -o /dev/null "${UI_URL}/api/auth/status"; then
      trust_workspace_cert || true
      return 0
    fi
    sleep 0.5
  done

  _alert "UI на localhost не ответил. Туннель поднят, но :19443 молчит — см. ${LOG_DIR}/tunnel.log"
  return 1
}

token=""
if [ -n "$cached_token" ] && require_identity; then
  load_session
  start_ui_tunnel
  if token="$(companion_refresh_session "$cached_token" "$UI_URL")"; then
    :
  elif [ "$?" -eq 2 ]; then
    printf '{"cacheRejected":true}\n' >&3
  else
    _alert "Не удалось восстановить сессию Layero Workspace."
    exit 1
  fi
fi
unset cached_token

if [ -z "$token" ]; then
  prompt_signin || exit 0
  load_session
  start_ui_tunnel
  for ((attempt = 1; attempt <= 3; attempt++)); do
    if token="$(companion_ui_login "$OWNER" "$COMPANION_LOGIN_PASSWORD" "$UI_URL")"; then
      break
    else
      login_status=$?
    fi
    if [ "$login_status" != 2 ]; then
      _alert "Не удалось получить сессию Layero Workspace. Проверьте подключение и повторите вход."
      exit 1
    fi
    if [ "$attempt" -eq 3 ]; then
      _alert "Вход не удался. Проверьте имя пользователя и пароль."
      exit 1
    fi
    COMPANION_LOGIN_PASSWORD=""
    prompt_signin "Неверное имя пользователя или пароль. Попробуйте ещё раз." || exit 0
    load_session
    start_ui_tunnel
  done
fi
unset COMPANION_LOGIN_PASSWORD

printf '{"token":"%s"}\n' "$token" >&3
unset token
exec 3>&-
if ! IFS= read -r -t 45 browser_status || [ "$browser_status" != ready ]; then
  echo "Workspace window did not load" >&2
  exit 1
fi

"$ROOT/bin/status-server.sh" || true
# Dev-server ports for the Browser panel; a failure only loses the preview.
"$ROOT/bin/start-preview-tunnel.sh" || true
agent_service="gui/$(id -u)/ai.layero.cloudcli-build-agent"
launchctl bootout "$agent_service" 2>/dev/null || true
launchctl bootstrap "${agent_service%/*}" "$PLIST_DST" 2>/dev/null || launchctl load "$PLIST_DST" 2>/dev/null || true
if ! launchctl kickstart -k "$agent_service" 2>/dev/null; then
  nohup "$HOME/.local/bin/cloudcli-build-agent" >>"$LOG_DIR/agent.log" 2>&1 &
fi

echo "Layero Workspace"
echo "  workspace: $WORKSPACE_HOST"
echo "  owner:     $OWNER"
echo "  UI:        $UI_URL"
echo "  gateway:   $GATEWAY"
echo "  checkout:  $CHECKOUT"
echo "  builds:    http://127.0.0.1:${STATUS_PORT}/"
echo "  agent:     labels owner=$OWNER,backend=local"

# Signal the Cocoa host that the session is ready (status window → «всё активно»).
python3 - "$LOG_DIR/ready.json" "$WORKSPACE_HOST" "$OWNER" "$UI_URL" "$GATEWAY" "$CHECKOUT" "$STATUS_PORT" <<'PY'
import json, sys, time
from pathlib import Path
path = Path(sys.argv[1])
path.write_text(json.dumps({
    "ready": True,
    "ts": int(time.time()),
    "workspaceHost": sys.argv[2],
    "owner": sys.argv[3],
    "uiUrl": sys.argv[4],
    "gatewayUrl": sys.argv[5],
    "checkout": sys.argv[6],
    "statusPort": int(sys.argv[7]),
}, indent=2) + "\n")
path.chmod(0o600)
PY

# Stay alive while the Mac .app is open. Quit of the app → SIGTERM → cleanup via stop-workspace.
echo $$ >"$LOG_DIR/companion.pid"
idle_pid=""
cleanup_on_signal() {
  if [ -n "$idle_pid" ]; then
    kill "$idle_pid" 2>/dev/null || true
  fi
  rm -f "$LOG_DIR/companion.pid" "$LOG_DIR/ready.json"
  exit 0
}
trap cleanup_on_signal TERM INT
while true; do
  sleep 3600 &
  idle_pid=$!
  wait "$idle_pid" || true
done
