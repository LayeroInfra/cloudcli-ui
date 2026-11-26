# Sourced by workspace-trigger-build and workspace-add-user.
# Must match normalizeWorkspaceOwner() in server/modules/workspace-builds/services/workspace-builds.service.ts
# and job_normalize_owner() in companion/bin/lib/workspace-job-env.sh.
normalize_workspace_owner() {
  printf "%s" "$1" | tr "[:upper:]" "[:lower:]" | sed -E "s/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//"
}

is_valid_workspace_username() {
  local name="$1"
  local owner
  owner="$(normalize_workspace_owner "$name")"
  [ "${#name}" -ge 3 ] && [ "$name" = "$owner" ]
}
