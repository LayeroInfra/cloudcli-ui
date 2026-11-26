#!/bin/bash
# Identity: workspace host + Layero Workspace username → SSH target and agent owner=<name>
# Credentials are collected in a branded Layero window (workspace always visible).
# Password is never written to identity.json — only kept in-process.
set -euo pipefail

IDENTITY_DIR="${HOME}/.config/layero-workspace"
IDENTITY_FILE="${IDENTITY_DIR}/identity.json"
DEFAULT_CHECKOUT="${CLOUDCLI_CHECKOUT:-$HOME/Layero/cloudcli}"

# In-process only (start-companion). Not persisted.
unset COMPANION_LOGIN_PASSWORD
COMPANION_LOGIN_PASSWORD=""

# Directory of this file → companion root (…/bin/lib → …)
_identity_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  echo "$here"
}

sanitize_owner() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

_ask_folder() {
  local prompt="$1"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "POSIX path of (choose folder with prompt \"${prompt}\")" 2>/dev/null | sed 's:/*$::' || true
  fi
}

_alert() {
  local text="$1"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display alert \"Layero Workspace\" message \"${text}\"" >/dev/null 2>&1 || true
  else
    echo "$text" >&2
  fi
}

_identity_read() {
  local key="$1"
  [ -f "$IDENTITY_FILE" ] || return 0
  python3 - "$IDENTITY_FILE" "$key" <<'PYTHON'
import json, sys
from pathlib import Path

try:
    data = json.loads(Path(sys.argv[1]).read_text())
except (OSError, ValueError):
    raise SystemExit(0)
if isinstance(data, dict):
    print(data.get(sys.argv[2], "") or "")
PYTHON
}

_write_identity() {
  mkdir -p "$IDENTITY_DIR"
  python3 - "$IDENTITY_FILE" "$1" "$2" "$3" "$4" <<'PYTHON'
import json, os, sys, tempfile
from pathlib import Path

target, host, owner, checkout, ssh_user = sys.argv[1:]
path = Path(target)
identity = {
    "workspaceHost": host,
    "owner": owner,
    "sshUser": ssh_user,
    "gatewayUrl": f"https://{host}",
    "checkout": checkout,
    "uiUrl": "https://127.0.0.1:19443",
}
with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as staged:
    try:
        json.dump(identity, staged, indent=2)
        staged.write("\n")
        staged.flush()
        os.replace(staged.name, path)
    finally:
        Path(staged.name).unlink(missing_ok=True)
PYTHON
}

_prompt_checkout() {
  local checkout="${1:-$DEFAULT_CHECKOUT}"
  if [ -d "$checkout" ]; then
    echo "$checkout"
    return 0
  fi
  local picked
  picked="$(_ask_folder "Папка репозитория для сборок (Cancel = создать ${DEFAULT_CHECKOUT}):")"
  if [ -n "${picked:-}" ]; then
    echo "$picked"
  else
    mkdir -p "$DEFAULT_CHECKOUT"
    echo "$DEFAULT_CHECKOUT"
  fi
}

# Opens branded Layero window: workspace + username + password together.
# Sets COMPANION_LOGIN_PASSWORD and writes identity.json (without password).
prompt_signin() {
  local root html pre_workspace form_workspace pre_owner checkout
  local mode=()
  if [ "${WORKSPACE_NATIVE_SESSION:-}" = 1 ]; then
    mode=(--native)
  fi
  root="$(_identity_root)"
  html="$root/app/signin/index.html"
  if [ ! -f "$html" ]; then
    _alert "Не найден экран входа Layero (app/signin/index.html)."
    return 1
  fi

  pre_workspace="$(_identity_read workspaceHost)"
  form_workspace="$pre_workspace"
  pre_owner=""
  if [ -n "${1:-}" ]; then
    pre_owner="$(_identity_read owner)"
  elif [ "${WORKSPACE_SWITCH:-}" = 1 ]; then
    form_workspace=""
  fi
  checkout="$(_identity_read checkout)"
  [ -n "$checkout" ] || checkout="$DEFAULT_CHECKOUT"

  local workspace_host owner password ssh_user
  if ! {
    IFS= read -r -d '' workspace_host &&
    IFS= read -r -d '' owner &&
    IFS= read -r -d '' password
  } < <(python3 "$root/bin/lib/signin-window.py" \
    --html "$html" \
    --workspace "$form_workspace" \
    --username "$pre_owner" --error "${1:-}" ${mode[@]+"${mode[@]}"}
  ); then
    return 1
  fi

  checkout="$(_prompt_checkout "$checkout")" || return 1
  ssh_user="$(identity_ssh_user "$workspace_host")"
  _write_identity "$workspace_host" "$owner" "$checkout" "${ssh_user:-${WORKSPACE_SSH_USER:-$owner}}" || return 1
  COMPANION_LOGIN_PASSWORD="$password"
}

require_identity() {
  if [ -z "$(_identity_read workspaceHost)" ] || [ -z "$(_identity_read owner)" ]; then
    echo "нет workspaceHost или owner в $IDENTITY_FILE" >&2
    return 1
  fi
}

identity_get() {
  _identity_read "$1"
}

identity_owner() {
  sanitize_owner "$(identity_get owner)"
}

identity_workspace_host() {
  identity_get workspaceHost
}

identity_ssh_user() {
  local workspace_host="$1" ssh_user
  local accounts
  for accounts in "$IDENTITY_DIR/ssh-users" "$(_identity_root)/secrets/ssh/users"; do
    if [ -f "$accounts" ]; then
      ssh_user="$(awk -v host="$workspace_host" '$1 == host { print $2; exit }' "$accounts")"
      if [ -n "$ssh_user" ]; then
        printf '%s\n' "$ssh_user"
        return
      fi
    fi
  done

  if [ "$workspace_host" = "$(_identity_read workspaceHost)" ]; then
    ssh_user="$(_identity_read sshUser)"
    if [ -n "$ssh_user" ]; then
      printf '%s\n' "$ssh_user"
      return
    fi
  fi

  # Migrate the SSH login previously configured for this workspace on this Mac.
  local config="$IDENTITY_DIR/ssh/config"
  [ -f "$config" ] || return 0
  awk -v host="$workspace_host" '$1 == "HostKeyAlias" && $2 == host { matched = 1 }
    $1 == "User" { user = $2 }
    END { if (matched && user) print user }' "$config"
}
