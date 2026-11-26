#!/bin/bash
# Layero Workspace VM: one idempotent install of everything the workspace
# runs besides the UI release itself (Forgejo, Woodpecker, the HTTPS gateway,
# the release server unit, the live preview, the build/deploy helpers and the
# checks pipeline). Run it as the workspace OS user, from a clone of the repo:
#
#   infra/vm/install.sh            install or update; prints what changed
#   infra/vm/install.sh --check    change nothing; list drift; exit 1 if any
#   infra/vm/install.sh --restart  also restart services whose files changed
#
# First install on a fresh VM also needs WORKSPACE_PUBLIC_IP (for the TLS
# certificate). Secrets are generated on the VM into ~/.local/state and never
# come from, or go into, the repo.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$INFRA/.." && pwd)"
VM="$INFRA/vm"
# shellcheck source=../versions.env
source "$INFRA/versions.env"
# shellcheck source=../lib/fetch.sh
source "$INFRA/lib/fetch.sh"

MODE=apply
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --restart) RESTART=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

WORKSPACES_ROOT="${WORKSPACES_ROOT:-$(dirname "$REPO")}"
BIN="$HOME/.local/bin"
UNITS="$HOME/.config/systemd/user"
STATE="$HOME/.local/state"
WP_STATE="$STATE/woodpecker"
INFRA_STATE="$STATE/layero-infra"
SHARE="$HOME/.local/share/layero-infra"
PIPELINE_REPO=buildadmin/cloudcli-checks
FORGEJO_URL=http://127.0.0.1:3030
WOODPECKER_URL=http://127.0.0.1:8000

DRIFT=()
CHANGED_UNITS=()
TODO=()

say() { printf '%s\n' "$*"; }
drift() { DRIFT+=("$1"); say "  ~ $1"; }

# ---------------------------------------------------------------- files

# place <rendered-file> <dest> <mode> [secret]: install when different; in --check only report.
place() {
  local src="$1" dest="$2" mode="$3" secret="${4:-}"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    return 1
  fi
  if [ "$MODE" = check ]; then
    drift "$dest"
    if [ -f "$dest" ] && [ -z "$secret" ]; then
      diff -u "$dest" "$src" | sed -n '3,40p' | sed 's/^/      /' || true
    fi
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  # Backups out of the way: a *.bak beside a unit is read by nobody, beside a helper it lands on PATH.
  if [ -f "$dest" ]; then
    mkdir -p "$INFRA_STATE/backup"
    cp -p "$dest" "$INFRA_STATE/backup/$(echo "${dest#"$HOME"/}" | tr / _).$(date +%Y%m%d%H%M%S)"
  fi
  install -m "$mode" "$src" "$dest"
  say "  + $dest"
  return 0
}

# render <template> <dest> <mode> [secret]: fill @KEY@ placeholders from the environment of this script.
render() {
  local template="$1" dest="$2" mode="$3" secret="${4:-}" tmp
  tmp="$(mktemp)"
  python3 - "$template" "$tmp" <<'PY'
import os, re, sys
text = open(sys.argv[1]).read()
def sub(match):
    key = match.group(1)
    if key not in os.environ:
        sys.exit(f"template {sys.argv[1]}: no value for @{key}@")
    return os.environ[key]
open(sys.argv[2], "w").write(re.sub(r"@([A-Z][A-Z0-9_]*)@", sub, text))
PY
  local status=0
  place "$tmp" "$dest" "$mode" "$secret" || status=$?
  rm -f "$tmp"
  return "$status"
}

export HOME USER="${USER:-$(id -un)}" REPO WORKSPACES_ROOT NODE_VERSION

# ---------------------------------------------------------------- preflight

say "Layero Workspace VM ($MODE) — repo $REPO"
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo "only Linux x86_64 is supported" >&2; exit 1; }
for tool in curl python3 openssl git flock systemctl; do
  command -v "$tool" >/dev/null || { echo "missing $tool (install it with the OS package manager)" >&2; exit 1; }
done
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != yes ]; then
  TODO+=("as root: loginctl enable-linger $USER   (user services keep running after logout and start at boot)")
fi
mkdir -p "$BIN" "$UNITS" "$WP_STATE" "$INFRA_STATE" "$SHARE" "$STATE/dev-tmp" "$STATE/forgejo" \
  "$STATE/workspace-gateway" "$STATE/cloudcli-live" "$HOME/.config/forgejo" "$HOME/.config/woodpecker" \
  "$HOME/.config/workspace-gateway/certs" "$HOME/.local/share/cloudcli-releases"
chmod 700 "$WP_STATE" "$INFRA_STATE"

# ---------------------------------------------------------------- pinned binaries

say "binaries"
version_of() { "$BIN/$1" "${2:---version}" 2>/dev/null | head -n1 || true; }

ensure_tool() {
  local name="$1" want="$2" current="$3" installer="$4"
  if [[ "$current" == *"$want"* ]]; then return 0; fi
  if [ "$MODE" = check ]; then drift "$name $want (have: ${current:-none})"; return 0; fi
  "$installer"
  say "  + $name $want"
}

install_node_vm() {
  install_node linux-x64 "$NODE_LINUX_X64_SHA256"
  ln -sfn "$HOME/.local/lib/node-v${NODE_VERSION}-linux-x64/bin/node" "$BIN/node"
  ln -sfn "$HOME/.local/lib/node-v${NODE_VERSION}-linux-x64/bin/npx" "$BIN/npx"
}
install_wp_server() { fetch_woodpecker_binary server linux_amd64 "$WOODPECKER_SERVER_LINUX_AMD64_SHA256" "$BIN/woodpecker-server"; }
install_wp_cli() { fetch_woodpecker_binary cli linux_amd64 "$WOODPECKER_CLI_LINUX_AMD64_SHA256" "$BIN/woodpecker-cli"; }
install_forgejo() {
  fetch_verified "https://codeberg.org/forgejo/forgejo/releases/download/v${FORGEJO_VERSION}/forgejo-${FORGEJO_VERSION}-linux-amd64" \
    sha256 "$FORGEJO_LINUX_AMD64_SHA256" "$BIN/forgejo.new"
  chmod 755 "$BIN/forgejo.new" && mv "$BIN/forgejo.new" "$BIN/forgejo"
}
install_caddy() {
  local work; work="$(mktemp -d)"
  fetch_verified "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
    sha512 "$CADDY_LINUX_AMD64_SHA512" "$work/caddy.tgz"
  tar -xzf "$work/caddy.tgz" -C "$work" caddy && install -m 755 "$work/caddy" "$BIN/caddy"
  rm -rf "$work"
}

ensure_tool node "v$NODE_VERSION" "$(version_of node)" install_node_vm
ensure_tool woodpecker-server "$WOODPECKER_VERSION" "$(version_of woodpecker-server)" install_wp_server
ensure_tool woodpecker-cli "$WOODPECKER_VERSION" "$(version_of woodpecker-cli)" install_wp_cli
ensure_tool forgejo "$FORGEJO_VERSION" "$(version_of forgejo -v)" install_forgejo
ensure_tool caddy "v$CADDY_VERSION" "$(version_of caddy version)" install_caddy

# ---------------------------------------------------------------- helpers in ~/.local/bin

say "helpers"
for file in "$VM/bin/"*; do
  render "$file" "$BIN/$(basename "$file")" 755 || true
done
# What workspace-mac-runtime needs at run time, outside the repo.
place "$INFRA/versions.env" "$SHARE/versions.env" 644 || true
place "$INFRA/lib/fetch.sh" "$SHARE/fetch.sh" 644 || true

# ---------------------------------------------------------------- secrets

# Secrets live in ~/.local/state; a value already in a live config is adopted
# from there, so re-installing an existing VM changes nothing.
config_value() { [ -f "$1" ] && sed -nE "s/^${2}[[:space:]]*=[[:space:]]*//p" "$1" | head -n1; true; }

# ensure_secret <file> <config> <key> <command…>: the secret file, adopted or created once.
ensure_secret() {
  local file="$1" config="$2" key="$3" value; shift 3
  [ -s "$file" ] && return 0
  value="$(config_value "$config" "$key")"
  if [ "$MODE" = check ]; then
    [ -n "$value" ] || drift "$file (missing secret)"
    return 0
  fi
  if [ -n "$value" ]; then ( umask 077; printf '%s' "$value" > "$file" ); return 0; fi
  ( umask 077; "$@" | tr -d '\n' > "$file" )
}
# read_secret <file> <config> <key>: the value; in --check, the live config's when the file is not there yet.
read_secret() {
  if [ -s "$1" ]; then tr -d '\n' < "$1"; return 0; fi
  local value; value="$(config_value "$2" "$3")"
  printf '%s' "${value:-missing}"
}

APP_INI="$HOME/.config/forgejo/app.ini"
SERVER_ENV="$HOME/.config/woodpecker/server.env"

say "configuration"
ensure_secret "$INFRA_STATE/forgejo.secret_key" "$APP_INI" SECRET_KEY "$BIN/forgejo" generate secret SECRET_KEY
ensure_secret "$INFRA_STATE/forgejo.internal_token" "$APP_INI" INTERNAL_TOKEN "$BIN/forgejo" generate secret INTERNAL_TOKEN
ensure_secret "$INFRA_STATE/forgejo.jwt_secret" "$APP_INI" JWT_SECRET "$BIN/forgejo" generate secret JWT_SECRET
ensure_secret "$WP_STATE/agent.secret" "$SERVER_ENV" WOODPECKER_AGENT_SECRET openssl rand -hex 32
FORGEJO_SECRET_KEY="$(read_secret "$INFRA_STATE/forgejo.secret_key" "$APP_INI" SECRET_KEY)"
FORGEJO_INTERNAL_TOKEN="$(read_secret "$INFRA_STATE/forgejo.internal_token" "$APP_INI" INTERNAL_TOKEN)"
FORGEJO_JWT_SECRET="$(read_secret "$INFRA_STATE/forgejo.jwt_secret" "$APP_INI" JWT_SECRET)"
WOODPECKER_AGENT_SECRET="$(read_secret "$WP_STATE/agent.secret" "$SERVER_ENV" WOODPECKER_AGENT_SECRET)"
export FORGEJO_SECRET_KEY FORGEJO_INTERNAL_TOKEN FORGEJO_JWT_SECRET WOODPECKER_AGENT_SECRET

FORGEJO_CHANGED=0
GATEWAY_CHANGED=0
WOODPECKER_CHANGED=0
render "$VM/config/forgejo-app.ini" "$APP_INI" 600 secret && FORGEJO_CHANGED=1
render "$VM/config/Caddyfile" "$HOME/.config/workspace-gateway/Caddyfile" 644 && GATEWAY_CHANGED=1

CERT="$HOME/.config/workspace-gateway/certs/cert.pem"
if [ ! -s "$CERT" ]; then
  if [ "$MODE" = check ]; then
    drift "$CERT (missing)"
  elif [ -z "${WORKSPACE_PUBLIC_IP:-}" ]; then
    TODO+=("rerun with WORKSPACE_PUBLIC_IP=<VM public IP> to create the gateway TLS certificate")
  else
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=$WORKSPACE_PUBLIC_IP" \
      -addext "subjectAltName=IP:$WORKSPACE_PUBLIC_IP,DNS:localhost,IP:127.0.0.1" \
      -keyout "$HOME/.config/workspace-gateway/certs/key.pem" -out "$CERT" 2>/dev/null
    chmod 600 "$HOME/.config/workspace-gateway/certs/key.pem"
    say "  + $CERT (self-signed for $WORKSPACE_PUBLIC_IP; the Mac app trusts it on sign-in)"
    GATEWAY_CHANGED=1
  fi
fi

# ---------------------------------------------------------------- systemd user units

say "systemd units"
UNITS_CHANGED=0
unit_changed() { CHANGED_UNITS+=("$1"); UNITS_CHANGED=1; }
for file in "$VM/systemd/"*.service "$VM/systemd/"*.slice; do
  name="$(basename "$file")"
  render "$file" "$UNITS/$name" 644 && unit_changed "$name"
done
for dir in "$VM/systemd/"*.d; do
  name="$(basename "$dir")"
  for file in "$dir/"*.conf; do
    render "$file" "$UNITS/$name/$(basename "$file")" 644 && unit_changed "${name%.d}"
  done
  # Drop-ins on the VM the repo does not know about change behaviour silently.
  for live in "$UNITS/$name/"*.conf; do
    [ -e "$live" ] || continue
    [ -e "$dir/$(basename "$live")" ] && continue
    if [ "$(basename "$live")" = published-ui.conf ] && [ "$MODE" = apply ]; then
      # Folded into frontend-cloudcli.service; the base unit now runs the release.
      rm -f "$live"; say "  - $live"; unit_changed "${name%.d}"
    else
      drift "$live (not in repo)"
    fi
  done
done
# `systemctl set-property` writes here; the repo's memory.conf replaces it.
for live in "$HOME/.config/systemd/user.control/frontend-cloudcli.service.d/"50-Memory*.conf; do
  [ -e "$live" ] || continue
  if [ "$MODE" = apply ]; then rm -f "$live"; say "  - $live"; unit_changed frontend-cloudcli.service
  else drift "$live (replaced by infra/vm/systemd/frontend-cloudcli.service.d/memory.conf)"; fi
done

SERVICES=(forgejo.service woodpecker-server.service frontend-cloudcli.service workspace-gateway.service cloudui-live.service)
# What a restart would actually change: the unit's effective settings, not its file text.
EFFECTIVE=ExecStart,Environment,EnvironmentFiles,WorkingDirectory,BindPaths,MemoryMax,MemoryHigh,UMask,OOMScoreAdjust,Restart,Slice
effective() { systemctl --user show "$1" -p "$EFFECTIVE" 2>/dev/null | sed -E 's/ ; (start_time|stop_time|pid|code|status)=[^;}]*//g'; }
declare -A BEFORE=()
for unit in "${SERVICES[@]}"; do BEFORE[$unit]="$(effective "$unit")"; done
if [ "$MODE" = apply ]; then
  [ "$UNITS_CHANGED" = 1 ] && systemctl --user daemon-reload
  for unit in "${SERVICES[@]}"; do
    systemctl --user enable --quiet "$unit"
  done
fi

# start_or_restart <unit> <changed>: start what is down; restart a changed one only with --restart.
start_or_restart() {
  local unit="$1" changed="$2"
  [ "$MODE" = check ] && return 0
  if ! systemctl --user is-active --quiet "$unit"; then
    systemctl --user start "$unit" && say "  started $unit"
  elif [ "$changed" = 1 ]; then
    if [ "$RESTART" = 1 ]; then systemctl --user restart "$unit" && say "  restarted $unit"
    else TODO+=("systemctl --user restart $unit   (its files changed)"); fi
  fi
}
# A unit counts as changed when its effective settings moved (a reworded file does not).
in_changed() {
  local u
  for u in "${CHANGED_UNITS[@]+"${CHANGED_UNITS[@]}"}"; do
    if [ "$u" = "$1" ]; then
      [ "$MODE" = check ] && return 0
      [ "${BEFORE[$1]-}" != "$(effective "$1")" ] && return 0
      return 1
    fi
  done
  return 1
}
changed_flag() { if in_changed "$1" || [ "${2:-0}" = 1 ]; then echo 1; else echo 0; fi; }

start_or_restart forgejo.service "$(changed_flag forgejo.service "$FORGEJO_CHANGED")"

# ---------------------------------------------------------------- Forgejo: admin, token, pipeline repo, OAuth app

say "forgejo"
wait_http() {
  local url="$1" i
  for i in $(seq 1 30); do curl -fs -o /dev/null "$url" && return 0; sleep 1; done
  return 1
}
FORGEJO_UP=1
wait_http "$FORGEJO_URL/api/healthz" || FORGEJO_UP=0
[ "$FORGEJO_UP" = 1 ] || { drift "forgejo not answering on $FORGEJO_URL"; }

forgejo_api() { curl -fsS -H "Authorization: token $(tr -d '\n' < "$WP_STATE/forgejo.token")" -H 'Content-Type: application/json' "$@"; }

if [ "$FORGEJO_UP" = 1 ]; then
  if [ ! -s "$WP_STATE/forgejo.token" ]; then
    if [ "$MODE" = check ]; then drift "$WP_STATE/forgejo.token (Forgejo not bootstrapped)"
    else
      fj=("$BIN/forgejo" admin --config "$APP_INI")
      if ! "${fj[@]}" user list 2>/dev/null | awk '{print $2}' | grep -qx buildadmin; then
        ( umask 077
          "${fj[@]}" user create --username buildadmin --email buildadmin@localhost --admin \
            --random-password --must-change-password=false |
            sed -nE 's/.*password is .?([^ ]+).?$/\1/p' | tr -d "'\"" > "$INFRA_STATE/forgejo-buildadmin.password" )
        say "  + Forgejo admin buildadmin (password in $INFRA_STATE/forgejo-buildadmin.password)"
      fi
      ( umask 077
        "$BIN/forgejo" admin --config "$APP_INI" user generate-access-token --username buildadmin \
          --token-name "layero-infra-$(date +%s)" --scopes all --raw > "$WP_STATE/forgejo.token" )
      say "  + Forgejo API token"
    fi
  fi
  if [ -s "$WP_STATE/forgejo.token" ]; then
    if ! forgejo_api -o /dev/null "$FORGEJO_URL/api/v1/repos/$PIPELINE_REPO" 2>/dev/null; then
      if [ "$MODE" = check ]; then drift "Forgejo repo $PIPELINE_REPO missing"
      else
        forgejo_api -o /dev/null -X POST "$FORGEJO_URL/api/v1/user/repos" \
          -d '{"name":"cloudcli-checks","private":true,"auto_init":true,"default_branch":"main"}'
        say "  + Forgejo repo $PIPELINE_REPO"
      fi
    fi
    if [ ! -s "$WP_STATE/oauth.client_id" ]; then
      if [ "$MODE" = check ]; then drift "Woodpecker OAuth app missing"
      else
        forgejo_api -X POST "$FORGEJO_URL/api/v1/user/applications/oauth2" \
          -d "{\"name\":\"woodpecker\",\"redirect_uris\":[\"$WOODPECKER_URL/authorize\"],\"confidential_client\":true}" |
          python3 -c '
import json, os, sys
d = json.load(sys.stdin)
base = sys.argv[1]
for key, name in (("client_id", "oauth.client_id"), ("client_secret", "oauth.client_secret")):
    path = os.path.join(base, name)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write(d[key])
' "$WP_STATE"
        say "  + Forgejo OAuth app for Woodpecker"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------- Woodpecker server

say "woodpecker"
ensure_secret "$WP_STATE/oauth.client_id" "$SERVER_ENV" WOODPECKER_GITEA_CLIENT false
ensure_secret "$WP_STATE/oauth.client_secret" "$SERVER_ENV" WOODPECKER_GITEA_SECRET false
if [ -s "$WP_STATE/oauth.client_id" ] || [ -n "$(config_value "$SERVER_ENV" WOODPECKER_GITEA_CLIENT)" ]; then
  WOODPECKER_OAUTH_CLIENT_ID="$(read_secret "$WP_STATE/oauth.client_id" "$SERVER_ENV" WOODPECKER_GITEA_CLIENT)"
  WOODPECKER_OAUTH_CLIENT_SECRET="$(read_secret "$WP_STATE/oauth.client_secret" "$SERVER_ENV" WOODPECKER_GITEA_SECRET)"
  export WOODPECKER_OAUTH_CLIENT_ID WOODPECKER_OAUTH_CLIENT_SECRET
  render "$VM/config/woodpecker-server.env" "$SERVER_ENV" 600 secret && WOODPECKER_CHANGED=1
  start_or_restart woodpecker-server.service "$(changed_flag woodpecker-server.service "$WOODPECKER_CHANGED")"
fi

# The pipeline definition lives in ci/; Forgejo holds a copy Woodpecker reads.
if [ "$FORGEJO_UP" = 1 ] && [ -s "$WP_STATE/forgejo.token" ]; then
  current="$(forgejo_api "$FORGEJO_URL/api/v1/repos/$PIPELINE_REPO/contents/.woodpecker.yml" 2>/dev/null || true)"
  sync="$(python3 - "$REPO/ci/cloudcli-checks.woodpecker.yml" "$current" <<'PY'
import base64, json, sys
want = open(sys.argv[1], "rb").read()
try:
    cur = json.loads(sys.argv[2])
except ValueError:
    cur = None
if cur and base64.b64decode(cur.get("content", "")).rstrip(b"\n") == want.rstrip(b"\n"):
    print("same")
else:
    body = {"message": "Sync .woodpecker.yml from ci/cloudcli-checks.woodpecker.yml",
            "content": base64.b64encode(want).decode(), "branch": "main"}
    if cur:
        body["sha"] = cur["sha"]
    print(("PUT " if cur else "POST ") + json.dumps(body))
PY
)"
  if [ "$sync" != same ]; then
    if [ "$MODE" = check ]; then drift "Forgejo $PIPELINE_REPO/.woodpecker.yml differs from ci/cloudcli-checks.woodpecker.yml"
    else
      forgejo_api -o /dev/null -X "${sync%% *}" "$FORGEJO_URL/api/v1/repos/$PIPELINE_REPO/contents/.woodpecker.yml" -d "${sync#* }"
      say "  + pipeline .woodpecker.yml synced to Forgejo"
    fi
  fi
fi

if [ ! -s "$WP_STATE/user.token" ]; then
  TODO+=("Woodpecker login (once): on a Mac run companion/bin/setup-ci-tunnel.sh <workspace host>, open $WOODPECKER_URL, sign in with Forgejo as buildadmin, create a personal token under User settings → Personal access tokens, save it on the VM as $WP_STATE/user.token (chmod 600), rerun this script")
else
  wp_api() { curl -fsS -H "Authorization: Bearer $(tr -d '\n' < "$WP_STATE/user.token")" -H 'Content-Type: application/json' "$@"; }
  if ! wp_api -o /dev/null "$WOODPECKER_URL/api/repos/lookup/$PIPELINE_REPO" 2>/dev/null; then
    if [ "$MODE" = check ]; then drift "Woodpecker repo $PIPELINE_REPO not activated"
    elif [ -s "$WP_STATE/forgejo.token" ]; then
      remote_id="$(forgejo_api "$FORGEJO_URL/api/v1/repos/$PIPELINE_REPO" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
      wp_api -o /dev/null -X POST "$WOODPECKER_URL/api/repos?forge_remote_id=$remote_id"
      say "  + Woodpecker repo $PIPELINE_REPO activated"
    fi
  fi
fi

# ---------------------------------------------------------------- the rest of the services

say "services"
start_or_restart workspace-gateway.service "$(changed_flag workspace-gateway.service "$GATEWAY_CHANGED")"
if [ -f "$HOME/.local/share/cloudcli-releases/workspace-ui/SHIPPED_FROM" ]; then
  # Restarting it drops every chat session and terminal: only on request.
  start_or_restart frontend-cloudcli.service "$(changed_flag frontend-cloudcli.service)"
else
  TODO+=("no UI release yet: deploy one from a Mac (Builds → deploy job, or workspace-trigger-deploy)")
fi
if [ -d "$REPO/node_modules/vite" ]; then
  start_or_restart cloudui-live.service "$(changed_flag cloudui-live.service)"
else
  TODO+=("live preview: npm ci in $REPO, then systemctl --user start cloudui-live.service")
fi
if [ ! -d "$HOME/src/cloudcli-ui/node_modules" ]; then
  TODO+=("release dependencies: clone the UI repo to ~/src/cloudcli-ui and npm ci there (releases link its node_modules)")
fi

# ---------------------------------------------------------------- summary

say ""
if [ "$MODE" = check ]; then
  if [ "${#DRIFT[@]}" -eq 0 ]; then say "in sync with the repo"; else say "${#DRIFT[@]} item(s) differ from the repo; run infra/vm/install.sh to apply"; fi
fi
if [ "${#TODO[@]}" -gt 0 ]; then
  say "still to do by hand:"
  for item in "${TODO[@]}"; do say "  - $item"; done
fi
[ "$MODE" = check ] && [ "${#DRIFT[@]}" -gt 0 ] && exit 1
exit 0
