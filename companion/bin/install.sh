#!/bin/bash
# Install Layero Workspace into ~/Applications — a real .app that stays in the Dock.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SHARE="$HOME/.local/share/cloudcli-companion"
source "$ROOT/bin/lib/runtime-files.sh"
RUNTIME="$(cd "${WORKSPACE_RUNTIME_DIR:-$ROOT}" && pwd)"
require_runtime_files "$RUNTIME"
mkdir -p "$SHARE" "$HOME/.local/bin" "$HOME/Applications" "$HOME/.config/layero-workspace" \
  "$HOME/.local/state/cloudcli-companion" "$HOME/Library/LaunchAgents"

# Packages include the executable, so unpacking one does not require Swift.
APP_BINARY="$ROOT/app/Companion.app/Contents/MacOS/companion"
build_needed=0
if [ ! -x "$APP_BINARY" ]; then
  build_needed=1
else
  for source in "$ROOT/app/CompanionApp/"*.swift; do
    if [ "$source" -nt "$APP_BINARY" ]; then
      build_needed=1
      break
    fi
  done
fi
if [ "$build_needed" = 1 ]; then
  "$ROOT/bin/build-app.sh"
fi

if [ "$ROOT" != "$SHARE" ]; then
  rsync -a --delete \
    --exclude '.git/' \
    --exclude 'dist/' \
    --exclude 'secrets/' \
    --exclude 'agent/' \
    --exclude '/bin/woodpecker-agent' \
    --exclude '*.zip' \
    "$ROOT/" "$SHARE/"
fi
copy_runtime_files "$RUNTIME" "$SHARE"

chmod 755 "$SHARE/bin/"*.sh "$SHARE/bin/lib/"*.sh "$SHARE/bin/lib/"*.py 2>/dev/null || true
chmod 755 "$SHARE/app/Companion.app/Contents/MacOS/companion"

# Optional interactive identity. The app prompts on first launch by default.
if [ "${SKIP_IDENTITY:-1}" != "1" ]; then
  # shellcheck source=lib/identity.sh
  source "$SHARE/bin/lib/identity.sh"
  # shellcheck source=lib/ssh-tunnel.sh
  source "$SHARE/bin/lib/ssh-tunnel.sh"
  prompt_signin || exit 0
  ensure_companion_ssh "$SHARE" "$(identity_workspace_host)"
fi

install -m 755 "$SHARE/bin/cloudcli-build-agent" "$HOME/.local/bin/cloudcli-build-agent"
install -m 755 "$SHARE/bin/workspace-run-checks" "$HOME/.local/bin/workspace-run-checks"
install -m 755 "$SHARE/bin/start-companion.sh" "$HOME/.local/bin/layero-workspace"
install -m 755 "$SHARE/bin/stop-workspace.sh" "$HOME/.local/bin/layero-workspace-stop"

APP_DST="$HOME/Applications/Layero Workspace.app"
rm -rf "$APP_DST"
mkdir -p "$APP_DST/Contents/MacOS" "$APP_DST/Contents/Resources"
cp "$SHARE/app/Companion.app/Contents/Info.plist" "$APP_DST/Contents/Info.plist"
if [ -f "$SHARE/app/Companion.app/Contents/Resources/AppIcon.icns" ]; then
  cp "$SHARE/app/Companion.app/Contents/Resources/AppIcon.icns" "$APP_DST/Contents/Resources/AppIcon.icns"
fi
install -m 755 "$SHARE/app/Companion.app/Contents/MacOS/companion" "$APP_DST/Contents/MacOS/companion"

# Drop legacy hardcoded launchd; start-companion writes a portable one.
if [ "${WORKSPACE_KEEP_AGENT:-0}" != 1 ]; then
  launchctl bootout "gui/$(id -u)/ai.layero.cloudcli-build-agent" 2>/dev/null || true
fi

echo "Installed Layero Workspace"
echo "  app:     $APP_DST"
echo "  quit:    Cmd+Q / Quit — останавливает туннель, агент и companion"
echo "  start:   open \"$APP_DST\""
