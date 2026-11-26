#!/bin/bash
# Build a zip you can hand to a teammate: unpack → open Layero Workspace.app
# The web UI is served by the selected VM. Packaging is local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/Layero Workspace"

source "$ROOT/bin/lib/runtime-files.sh"
RUNTIME_SOURCE="${1:-${WORKSPACE_RUNTIME_DIR:-$ROOT}}"
RUNTIME="$(unpack_runtime "$RUNTIME_SOURCE")"
[ -d "$RUNTIME_SOURCE" ] || trap 'rm -rf "$RUNTIME"' EXIT
require_runtime_files "$RUNTIME"

# Build before copying so both bundled executables come from this build.
"$ROOT/bin/build-app.sh"

rm -rf "$DIST"
mkdir -p "$STAGE"

# Fresh install into a staging Applications-like layout is awkward; ship the
# share tree + a double-clickable app that points at it after first run of install.
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'dist/' \
  --exclude 'secrets/' \
  --exclude 'agent/' \
  --exclude '/bin/woodpecker-agent' \
  --exclude '*.zip' \
  "$ROOT/" "$STAGE/cloudcli-companion/"
copy_runtime_files "$RUNTIME" "$STAGE/cloudcli-companion"
# The zip has no infra/: carry the pins and the download helper install.sh reads.
for pair in "infra/versions.env:versions.env" "infra/lib/fetch.sh:bin/lib/fetch.sh"; do
  from="$ROOT/../${pair%%:*}"; [ -f "$from" ] || from="$ROOT/${pair#*:}"
  install -m 644 "$from" "$STAGE/cloudcli-companion/${pair#*:}"
done

# Real Cocoa .app (Dock while running; Quit → stop-workspace)
mkdir -p "$STAGE/Layero Workspace.app/Contents/MacOS" "$STAGE/Layero Workspace.app/Contents/Resources"
cp "$ROOT/app/Companion.app/Contents/Info.plist" "$STAGE/Layero Workspace.app/Contents/Info.plist"
if [ -f "$ROOT/app/Companion.app/Contents/Resources/AppIcon.icns" ]; then
  cp "$ROOT/app/Companion.app/Contents/Resources/AppIcon.icns" \
    "$STAGE/Layero Workspace.app/Contents/Resources/AppIcon.icns"
fi
install -m 755 "$ROOT/app/Companion.app/Contents/MacOS/companion" \
  "$STAGE/Layero Workspace.app/Contents/MacOS/companion"

cat >"$STAGE/README.txt" <<'EOF'
Layero Workspace
================

1. Откройте «Layero Workspace.app» (при первом запуске macOS спросит про безопасность — ПКМ → Открыть).
2. Иконка остаётся в Dock, пока приложение работает.
3. В окне Layero укажите адрес пространства, username и пароль.
4. Откроется UI на localhost; туннель и build-агент поднимутся сами.
5. Quit (Cmd+Q) останавливает все процессы workspace.

Аккаунт на сервере создаёт оператор:
  workspace-add-user <username> <password>

DNS: *.workspace.layero.app → IP нужной VM.
Сборки этого username идут на этот Mac.
EOF

ZIP="$DIST/Layero-Workspace-macOS.zip"
rm -f "$ZIP"
(
  cd "$DIST"
  ditto -c -k --sequesterRsrc --keepParent "Layero Workspace" "$(basename "$ZIP")"
)
echo "packed $ZIP"
ls -lh "$ZIP"
