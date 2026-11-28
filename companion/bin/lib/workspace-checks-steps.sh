# The CloudUI checks, shared by workspace-run-checks (any branch) and
# workspace-run-deploy (the main commit it ships, unless already green).
# Source it, cd into a clean checkout with node_modules, then:
#
#   run_check_steps [step ...]   # no steps: all of CHECK_STEPS; sets CHECK_FAILED, CHECK_RESULTS
#   quick_check_steps <base>     # the steps of a quick run (A5) for changes since <base>
#   print_check_summary <label>
#   post_check_status <sha> <state> <description>   # GitHub commit status, best effort
#
# Every step runs even after one fails. Tests listed in ci/checks-quarantine.txt
# are skipped. A new kind of check is a new step_<name> here plus its name in
# CHECK_STEPS — test files need nothing: every server and client test runs.
# shellcheck shell=bash

CHECK_STEPS=(swift shell lint typecheck test-server test-client fake-agent build)
# Steps that only a quick run uses: tests of what changed since WORKSPACE_CHECKS_BASE.
CHECK_EXTRA_STEPS=(test-server-changed test-client-changed)
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

# Files changed since the quick run's base commit (empty when there is none).
changed_files() {
  [ -n "${CHECK_BASE:-}" ] || return 0
  git diff --name-only "$CHECK_BASE" HEAD 2>/dev/null || true
}

# Server tests of the modules a change touched. server/shared, the server
# entry, its config or the lockfile touch everything: then all server tests.
step_test_server_changed() {
  local changed files=() f module all=0
  changed="$(changed_files)"
  if [ -z "${CHECK_BASE:-}" ]; then all=1; fi
  while IFS= read -r f; do
    case "$f" in
      server/shared/*|server/index.ts|server/load-env.ts|server/tsconfig.json|package-lock.json|package.json) all=1 ;;
    esac
  done <<< "$changed"
  if [ "$all" = 1 ]; then
    echo "shared server code or dependencies changed: all server tests"
    step_test_server
    return
  fi
  local modules=()
  while IFS= read -r f; do
    [[ "$f" =~ ^server/modules/([^/]+)/ ]] || continue
    module="${BASH_REMATCH[1]}"
    check_in_list "$module" ${modules[@]+"${modules[@]}"} || modules+=("$module")
  done <<< "$changed"
  if [ "${#modules[@]}" -eq 0 ]; then
    echo "no server module changed: no server tests"
    return 0
  fi
  for module in "${modules[@]}"; do
    while IFS= read -r f; do
      check_in_list "$f" ${CHECK_QUARANTINE[@]+"${CHECK_QUARANTINE[@]}"} || files+=("$f")
    done < <(git ls-files "server/modules/$module/*.test.ts" "server/modules/$module/*.test.js")
  done
  echo "changed modules: ${modules[*]} — ${#files[@]} test files"
  [ "${#files[@]}" -gt 0 ] || return 0
  tsx --tsconfig server/tsconfig.json --test "${files[@]}"
}

# Client tests that import a changed file (vitest follows the import graph).
step_test_client_changed() {
  if [ -z "${CHECK_BASE:-}" ]; then
    step_test_client
    return
  fi
  local args=() f
  for f in ${CHECK_QUARANTINE[@]+"${CHECK_QUARANTINE[@]}"}; do
    [[ "$f" == src/* ]] && args+=(--exclude "$f")
  done
  vitest run --changed "$CHECK_BASE" --passWithNoTests --pool=forks --maxWorkers=1 --fileParallelism=false ${args[@]+"${args[@]}"}
}

# The steps of a quick run for the changes since <base>: lint, typecheck and
# shell syntax always (seconds), the changed tests, and Swift or the fake agent
# only when their code changed. No build. Not the gate: it posts no status.
quick_check_steps() {
  local changed steps=(shell lint typecheck test-server-changed test-client-changed)
  CHECK_BASE="$1"
  changed="$(changed_files)"
  grep -q '^companion/app/' <<< "$changed" && steps=(swift "${steps[@]}")
  grep -q '^ci/fake-claude/' <<< "$changed" && steps+=(fake-agent)
  echo "${steps[@]}"
}

# The stand-in Claude CLI the stage and e2e runs use must still speak the SDK's protocol.
step_fake_agent() { node --test ci/fake-claude/fake-claude.test.mjs; }

step_build() { npm run --silent build; }

run_check_steps() {
  local want=("$@") s start r
  load_check_quarantine
  CHECK_RESULTS=()
  CHECK_FAILED=0
  for s in "${CHECK_STEPS[@]}" "${CHECK_EXTRA_STEPS[@]}"; do
    if [ "${#want[@]}" -gt 0 ]; then
      check_in_list "$s" "${want[@]}" || continue
    else
      # A full run is CHECK_STEPS; the *-changed steps are for quick runs only.
      check_in_list "$s" "${CHECK_STEPS[@]}" || continue
    fi
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
