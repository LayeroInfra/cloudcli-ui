# The CloudUI checks, shared by workspace-run-checks (any branch) and
# workspace-run-deploy (the main commit it ships, unless already green).
# Source it, cd into a clean checkout with node_modules, then:
#
#   run_check_steps [step ...]   # no steps: all of CHECK_STEPS; sets CHECK_FAILED, CHECK_RESULTS
#   print_check_summary <label>
#   post_check_status <sha> <state> <description>   # GitHub commit status, best effort
#
# Every step runs even after one fails. Tests listed in ci/checks-quarantine.txt
# are skipped. A new kind of check is a new step_<name> here plus its name in
# CHECK_STEPS — test files need nothing: every server and client test runs.
# shellcheck shell=bash

CHECK_STEPS=(swift shell lint typecheck test-server test-client fake-agent build)
CHECK_GITHUB_REPO="${WORKSPACE_GITHUB_REPO:-LayeroInfra/cloudcli-ui}"
CHECK_STATUS_CONTEXT="workspace/checks"

check_in_list() { local x="$1"; shift; for y in "$@"; do [ "$x" = "$y" ] && return 0; done; return 1; }

load_check_quarantine() {
  CHECK_QUARANTINE=()
  local line path
  [ -f ci/checks-quarantine.txt ] || return 0
  while IFS= read -r line; do
    path="${line%%#*}"; path="$(printf '%s' "$path" | tr -d '[:space:]')"
    [ -n "$path" ] && CHECK_QUARANTINE+=("$path")
  done < ci/checks-quarantine.txt
}

step_swift() { swiftc -typecheck companion/app/CompanionApp/*.swift; }

step_shell() {
  local f bad=0
  while IFS= read -r f; do
    head -n1 "$f" | grep -qE '^#!.*(bash|sh)' || continue
    bash -n "$f" || { echo "syntax error: $f"; bad=1; }
  done < <(git ls-files companion/bin infra ci)
  return "$bad"
}

step_lint() { npm run --silent lint; }

step_typecheck() { npm run --silent typecheck; }

step_test_server() {
  local files=() f
  while IFS= read -r f; do
    check_in_list "$f" ${CHECK_QUARANTINE[@]+"${CHECK_QUARANTINE[@]}"} || files+=("$f")
  done < <(git ls-files 'server/*.test.ts' 'server/*.test.js')
  echo "${#files[@]} server test files"
  tsx --tsconfig server/tsconfig.json --test "${files[@]}"
}

step_test_client() {
  local args=() f
  for f in ${CHECK_QUARANTINE[@]+"${CHECK_QUARANTINE[@]}"}; do
    [[ "$f" == src/* ]] && args+=(--exclude "$f")
  done
  # One forked worker: the vitest worker pool crashes under the Mac agent otherwise
  # (ERR_IPC_CHANNEL_CLOSED, runs #21 and #26).
  vitest run --pool=forks --maxWorkers=1 --fileParallelism=false ${args[@]+"${args[@]}"}
}

# The stand-in Claude CLI the stage and e2e runs use must still speak the SDK's protocol.
step_fake_agent() { node --test ci/fake-claude/fake-claude.test.mjs; }

step_build() { npm run --silent build; }

run_check_steps() {
  local want=("$@") s start r
  load_check_quarantine
  CHECK_RESULTS=()
  CHECK_FAILED=0
  for s in "${CHECK_STEPS[@]}"; do
    if [ "${#want[@]}" -gt 0 ] && ! check_in_list "$s" "${want[@]}"; then continue; fi
    echo ""
    echo "==> $s"
    start=$(date +%s)
    if "step_${s//-/_}"; then r=ok; else r=FAILED; CHECK_FAILED=$((CHECK_FAILED + 1)); fi
    CHECK_RESULTS+=("$(printf '%-12s %-6s %4ss' "$s" "$r" "$(( $(date +%s) - start ))")")
  done
}

print_check_summary() {
  echo ""
  echo "==> summary for $1"
  printf '  %s\n' "${CHECK_RESULTS[@]}"
  if [ "${#CHECK_QUARANTINE[@]}" -gt 0 ]; then
    echo "  quarantined (not run): ${#CHECK_QUARANTINE[@]} — see ci/checks-quarantine.txt"
  fi
}

post_check_status() {
  command -v gh >/dev/null 2>&1 || return 0
  gh api -X POST "repos/$CHECK_GITHUB_REPO/statuses/$1" \
    -f state="$2" -f context="$CHECK_STATUS_CONTEXT" -f description="$3" >/dev/null 2>&1 ||
    echo "(GitHub status not posted: gh not signed in, or $1 not pushed yet)"
}

# check_status_is_green <sha>: true when GitHub already has workspace/checks = success for it.
check_status_is_green() {
  command -v gh >/dev/null 2>&1 || return 1
  [ "$(gh api "repos/$CHECK_GITHUB_REPO/commits/$1/statuses" \
    --jq "[.[] | select(.context == \"$CHECK_STATUS_CONTEXT\")][0].state" 2>/dev/null)" = success ]
}
