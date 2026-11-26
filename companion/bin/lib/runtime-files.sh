#!/bin/bash
# Install operator-supplied runtime files. Keep these out of the source tree.
# The VM builds them: `workspace-mac-runtime` → layero-mac-runtime.tar.gz.
# agent.conf is not among them: each Mac's agent writes its own (its agent id),
# a shared one makes every Mac register as the same agent.
# shellcheck shell=bash

# unpack_runtime <dir|.tar.gz>: prints a directory holding the runtime files.
unpack_runtime() {
  local source="$1" dir
  if [ -d "$source" ]; then
    (cd "$source" && pwd)
    return 0
  fi
  if [ -f "$source" ]; then
    dir="$(mktemp -d)"
    chmod 700 "$dir"
    tar -xzf "$source" -C "$dir"
    echo "$dir"
    return 0
  fi
  echo "Layero Workspace: no runtime at $source" >&2
  return 1
}

require_runtime_files() {
  local source="$1" file
  for file in secrets/ssh/id_ed25519 agent/agent.secret bin/woodpecker-agent; do
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
  install -m 755 "$source/bin/woodpecker-agent" "$target/bin/woodpecker-agent"
}
