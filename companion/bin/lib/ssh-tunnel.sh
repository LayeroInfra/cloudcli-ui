#!/bin/bash
# Portable SSH config for the companion tunnel (bundled shared key).
# HostName comes from DNS A/AAAA of workspaceHost (*.workspace.layero.app).
# shellcheck shell=bash

companion_ssh_dir() {
  echo "${HOME}/.config/layero-workspace/ssh"
}

# Resolve workspace FQDN → IPv4 (preferred) or IPv6.
resolve_workspace_ip() {
  local host="$1"
  python3 - "$host" <<'PY'
import socket, sys
host = sys.argv[1]
# Prefer IPv4 for SSH HostName simplicity
try:
    infos = socket.getaddrinfo(host, 22, socket.AF_INET, socket.SOCK_STREAM)
    if infos:
        print(infos[0][4][0])
        raise SystemExit(0)
except OSError:
    pass
try:
    infos = socket.getaddrinfo(host, 22, socket.AF_INET6, socket.SOCK_STREAM)
    if infos:
        print(infos[0][4][0])
        raise SystemExit(0)
except OSError:
    pass
raise SystemExit(1)
PY
}

ensure_companion_ssh() {
  local root="${1:-}"
  local workspace_host="${2:-}"
  local ip="${3:-}"
  local dest
  dest="$(companion_ssh_dir)"
  mkdir -p "$dest"
  chmod 700 "$dest"

  # Prefer bundled secrets; fall back to already-installed copies.
  local src_key
  if [ -n "$root" ] && [ -f "$root/secrets/ssh/id_ed25519" ]; then
    src_key="$root/secrets/ssh/id_ed25519"
  elif [ -f "$HOME/.local/share/cloudcli-companion/secrets/ssh/id_ed25519" ]; then
    src_key="$HOME/.local/share/cloudcli-companion/secrets/ssh/id_ed25519"
  else
    echo "нет bundled SSH-ключа companion (secrets/ssh/)" >&2
    return 1
  fi

  if [ ! -f "$dest/id_ed25519" ]; then
    cp -f "$src_key" "$dest/id_ed25519"
    chmod 600 "$dest/id_ed25519"
  fi
  local ssh_user
  ssh_user="$(identity_ssh_user "$workspace_host")"
  ssh_user="${ssh_user:-${WORKSPACE_SSH_USER:-$(identity_owner)}}"
  if ! [[ "$ssh_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]]; then
    echo "некорректное имя SSH-пользователя" >&2
    return 1
  fi
  touch "$dest/known_hosts"
  chmod 600 "$dest/known_hosts"

  if ! [[ "$workspace_host" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
    echo "некорректный workspaceHost" >&2
    return 1
  fi

  if [ -z "$ip" ] && ! ip="$(resolve_workspace_ip "$workspace_host")"; then
    echo "не резолвится ${workspace_host} (нужен DNS A/AAAA на IP VM)" >&2
    return 1
  fi

  # Operator-provided host pins bootstrap fresh Macs. Preserve an existing
  # local pin even if a newly installed runtime includes another key.
  local bundled_hosts
  bundled_hosts="$(dirname "$src_key")/known_hosts"
  if [ -s "$bundled_hosts" ] &&
    ! ssh-keygen -F "$workspace_host" -f "$dest/known_hosts" >/dev/null
  then
    (ssh-keygen -F "$workspace_host" -f "$bundled_hosts" || true) |
      awk '$1 !~ /^#/' >>"$dest/known_hosts"
  fi

  # Carry an existing IP-based pin forward when migrating from an older install.
  if [ "$workspace_host" != "$ip" ] &&
    ! ssh-keygen -F "$workspace_host" -f "$dest/known_hosts" >/dev/null
  then
    local previous_keys
    previous_keys="$(ssh-keygen -F "$ip" -f "$dest/known_hosts" || true)"
    if [ -n "$previous_keys" ]; then
      printf '%s\n' "$previous_keys" |
        awk -v host="$workspace_host" '$1 !~ /^#/ {$1 = host; print}' >>"$dest/known_hosts"
    fi
  fi

  cat >"$dest/config" <<EOF
Host layero-workspace
  HostName ${ip}
  User ${ssh_user}
  HostKeyAlias ${workspace_host}
  IdentityFile "${dest}/id_ed25519"
  IdentitiesOnly yes
  UserKnownHostsFile "${dest}/known_hosts"
  StrictHostKeyChecking accept-new
  ForwardAgent no
  ServerAliveInterval 15
  ConnectTimeout 10
EOF
  chmod 600 "$dest/config"

}
