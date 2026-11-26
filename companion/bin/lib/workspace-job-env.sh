# Sourced by the workspace-run-* jobs a Woodpecker local step runs on a Mac.
# Woodpecker may sandbox HOME: use the real user home, read identity.json.
# shellcheck shell=bash

REAL_HOME="/Users/$(/usr/bin/id -un)"
if [ -f "$REAL_HOME/.config/layero-workspace/identity.json" ]; then
  export HOME="$REAL_HOME"
fi
IDENTITY_FILE="${HOME}/.config/layero-workspace/identity.json"
if [ ! -f "$IDENTITY_FILE" ]; then
  echo "missing identity: $IDENTITY_FILE" >&2
  exit 1
fi

job_identity() {
  python3 - "$IDENTITY_FILE" "$1" <<'PY'
import json, sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text()).get(sys.argv[2], "") or "")
PY
}

# Same rule as normalizeWorkspaceOwner() on the server and workspace-owner-lib.sh on the VM.
job_normalize_owner() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//'
}

JOB_CHECKOUT="$(job_identity checkout)"
JOB_OWNER="$(job_normalize_owner "$(job_identity owner)")"
if [ -z "$JOB_CHECKOUT" ] || [ ! -d "$JOB_CHECKOUT" ]; then
  echo "checkout missing: $JOB_CHECKOUT (owner=$JOB_OWNER)" >&2
  exit 1
fi
# The agent only takes jobs labelled with this Mac's owner; a mismatch means a misrouted run.
if [ -n "${WORKSPACE_OWNER:-}" ] && [ "$(job_normalize_owner "$WORKSPACE_OWNER")" != "$JOB_OWNER" ]; then
  echo "run is for owner=$WORKSPACE_OWNER, this Mac is owner=$JOB_OWNER" >&2
  exit 1
fi
# The pinned Node from install.sh first; Homebrew for everything else.
export PATH="$HOME/.local/lib/layero-node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
