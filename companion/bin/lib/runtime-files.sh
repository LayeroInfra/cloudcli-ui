#!/bin/bash
# Install operator-supplied runtime files. Keep these out of the source tree.
# shellcheck shell=bash

require_runtime_files() {
  local source="$1" file
  for file in secrets/ssh/id_ed25519 agent/agent.secret agent/agent.conf bin/woodpecker-agent; do
    if [ ! -s "$source/$file" ]; then
      echo "Layero Workspace: missing $file in $source (set WORKSPACE_RUNTIME_DIR)" >&2
      return 1
    fi
  done
}

copy_runtime_files() {
  local source="$1" target="$2"
  [ "$source" != "$target" ] || return 0
  mkdir -p "$target/bin" "$target/agent"
  install -d -m 700 "$target/secrets/ssh"
  install -m 600 "$source/secrets/ssh/id_ed25519" "$target/secrets/ssh/id_ed25519"
  install -m 600 "$source/agent/agent.secret" "$target/agent/agent.secret"
  install -m 644 "$source/agent/agent.conf" "$target/agent/agent.conf"
  install -m 755 "$source/bin/woodpecker-agent" "$target/bin/woodpecker-agent"
}
