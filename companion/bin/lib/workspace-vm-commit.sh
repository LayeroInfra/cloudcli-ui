# Shared by workspace-run-checks and workspace-run-stage: put one commit of the
# CloudUI checkout on the VM into a clean clone on this Mac. The commit comes
# straight from the VM over the companion SSH key, so it need not be pushed
# first; uncommitted edits on the VM never come along.
# shellcheck shell=bash

VM_COMMIT_SSH_CONFIG="${HOME}/.config/layero-workspace/ssh/config"
VM_COMMIT_SSH_HOST="${WORKSPACE_DEPLOY_SSH_HOST:-layero-workspace}"
VM_COMMIT_REPO="${WORKSPACE_CHECKS_VM_REPO:-/srv/Layero/cloud-cli}"
export GIT_SSH_COMMAND="ssh -F $VM_COMMIT_SSH_CONFIG -o BatchMode=yes"

# vm_commit_checkout <dir> <ref|""> <sha|"">: fetch and check out; sets VM_REF and VM_SHA.
# An empty ref means the VM checkout's current branch, an empty sha its tip.
vm_commit_checkout() {
  local dir="$1" tip
  VM_REF="$2"
  VM_SHA="$3"
  [ -z "$VM_REF" ] || [[ "$VM_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "bad ref $VM_REF" >&2; return 2; }
  [ -z "$VM_SHA" ] || [[ "$VM_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "sha must be a 40-hex commit" >&2; return 2; }
  if [ -z "$VM_REF" ]; then
    VM_REF="$(git ls-remote --symref "$VM_COMMIT_SSH_HOST:$VM_COMMIT_REPO" HEAD | sed -nE 's#^ref: refs/heads/([^[:space:]]+)[[:space:]]+HEAD$#\1#p')"
    [ -n "$VM_REF" ] || { echo "VM checkout $VM_COMMIT_REPO: HEAD is not on a branch; name one" >&2; return 1; }
  fi
  [ -e "$dir/.git" ] || git init -q "$dir"
  git -C "$dir" fetch -q --no-tags "$VM_COMMIT_SSH_HOST:$VM_COMMIT_REPO" "+refs/heads/$VM_REF:refs/remotes/vm/$VM_REF"
  tip="$(git -C "$dir" rev-parse "refs/remotes/vm/$VM_REF")"
  [ -n "$VM_SHA" ] || VM_SHA="$tip"
  git -C "$dir" merge-base --is-ancestor "$VM_SHA" "$tip" ||
    { echo "commit $VM_SHA is not on VM branch $VM_REF" >&2; return 1; }
  git -C "$dir" checkout -q --force --detach "$VM_SHA"
  # Build output and stray files go; node_modules stays (vm_commit_npm_ci reinstalls it on a lockfile change).
  git -C "$dir" clean -qfdx -e node_modules
}

# vm_commit_npm_ci <dir>: npm ci only when package-lock.json changed since the last install there.
vm_commit_npm_ci() {
  local dir="$1" hash
  hash="$(shasum -a 256 "$dir/package-lock.json" | cut -d' ' -f1)"
  if [ ! -d "$dir/node_modules" ] || [ "$(cat "$dir/node_modules/.vm-commit-lock-hash" 2>/dev/null)" != "$hash" ]; then
    echo "==> npm ci (package-lock.json changed)"
    (cd "$dir" && npm ci --no-audit --no-fund)
    echo "$hash" > "$dir/node_modules/.vm-commit-lock-hash"
  fi
}

# vm_commit_lock <root> <name>: one run per clone; macOS has no flock(1), mkdir is the lock.
# Releases it on exit unless the caller replaces the EXIT trap (then it must rmdir "$VM_COMMIT_LOCK").
vm_commit_lock() {
  VM_COMMIT_LOCK="$1/.lock-$2.d"
  mkdir -p "$1"
  find "$VM_COMMIT_LOCK" -maxdepth 0 -mmin +120 -exec rmdir {} \; 2>/dev/null || true
  until mkdir "$VM_COMMIT_LOCK" 2>/dev/null; do echo "waiting for another $2 run"; sleep 15; done
  # shellcheck disable=SC2064
  trap "rmdir '$VM_COMMIT_LOCK'" EXIT
}
