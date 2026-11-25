#!/bin/bash
# Одноразовый туннель к Woodpecker и Forgejo выбранного пространства.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/bin/lib/identity.sh"
source "$ROOT/bin/lib/ssh-tunnel.sh"

require_identity
ensure_companion_ssh "$ROOT" "$(identity_workspace_host)"
exec ssh -F "$(companion_ssh_dir)/config" \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8000:127.0.0.1:8000 \
  -L 127.0.0.1:3030:127.0.0.1:3030 \
  -N layero-workspace
