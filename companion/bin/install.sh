#!/bin/bash
# Install Layero Workspace into ~/Applications — a real .app that stays in the Dock.
#
#   companion/bin/install.sh --runtime layero-mac-runtime.tar.gz
#
# The runtime archive comes from the VM (`workspace-mac-runtime`). Without
# --runtime the files already in the package or WORKSPACE_RUNTIME_DIR are used.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RUNTIME_SOURCE="${WORKSPACE_RUNTIME_DIR:-$ROOT}"
while [ $# -gt 0 ]; do
  case "$1" in
    --runtime) RUNTIME_SOURCE="${2:?--runtime needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(uname -s)-$(uname -m)" = Darwin-arm64 ] || { echo "Layero Workspace needs an Apple Silicon Mac" >&2; exit 1; }
for tool in python3 rsync curl git; do
  command -v "$tool" >/dev/null || { echo "missing $tool: xcode-select --install" >&2; exit 1; }
done

SHARE="$HOME/.local/share/cloudcli-companion"
source "$ROOT/bin/lib/runtime-files.sh"
RUNTIME="$(unpack_runtime "$RUNTIME_SOURCE")"
# An unpacked archive holds the SSH key and agent secret: never leave it behind.
[ -d "$RUNTIME_SOURCE" ] || trap 'rm -rf "$RUNTIME"' EXIT
require_runtime_files "$RUNTIME"

# The pinned Node the checks and deploys run with (infra/versions.env; packages carry a copy).
VERSIONS="$ROOT/../infra/versions.env"
[ -f "$VERSIONS" ] || VERSIONS="$ROOT/versions.env"
FETCH_LIB="$ROOT/../infra/lib/fetch.sh"
[ -f "$FETCH_LIB" ] || FETCH_LIB="$ROOT/bin/lib/fetch.sh"
# shellcheck source=../../infra/versions.env
source "$VERSIONS"
# shellcheck source=../../infra/lib/fetch.sh
source "$FETCH_LIB"
install_node darwin-arm64 "$NODE_DARWIN_ARM64_SHA256"
ln -sfn "$HOME/.local/lib/node-v${NODE_VERSION}-darwin-arm64" "$HOME/.local/lib/layero-node"
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
# Older runtimes shipped one agent.conf to every Mac, so all agents shared an id.
# Drop it once; the agent writes its own on the next start.
if [ -f "$SHARE/agent/agent.conf" ] && [ ! -f "$SHARE/agent/.own-agent-conf" ]; then
  rm -f "$SHARE/agent/agent.conf"
fi
touch "$SHARE/agent/.own-agent-conf"
# Packages built from this install carry the pins and the download helper too.
install -m 644 "$VERSIONS" "$SHARE/versions.env"
install -m 644 "$FETCH_LIB" "$SHARE/bin/lib/fetch.sh"

chmod 755 "$SHARE/bin/"*.sh "$SHARE/bin/workspace-run-"* "$SHARE/bin/lib/"*.sh "$SHARE/bin/lib/"*.py 2>/dev/null || true
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
for job in workspace-run-job workspace-run-checks workspace-run-deploy; do
  install -m 755 "$SHARE/bin/$job" "$HOME/.local/bin/$job"
done
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
