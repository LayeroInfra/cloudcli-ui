#!/bin/bash
# Authenticate through the workspace tunnel. Return the token on stdout.
# shellcheck shell=bash

companion_ui_login() {
  local username="$1" password="$2" ui_url="$3"
  local response

  response="$(
    printf '%s' "$password" |
      python3 -c 'import json, sys; print(json.dumps({"username": sys.argv[1], "password": sys.stdin.read()}))' "$username" |
      curl --noproxy '*' -sk --max-time 15 --write-out '\n%{http_code}' \
        -H 'Content-Type: application/json' --data-binary @- "${ui_url}/api/auth/login"
  )" || return 1
  _companion_extract_token "$response"
}

companion_refresh_session() {
  local token="$1" ui_url="$2" response
  [[ "$token" =~ ^[A-Za-z0-9._~-]+$ ]] || return 2
  response="$(
    printf 'Authorization: Bearer %s\n' "$token" |
      curl --noproxy '*' -sk --max-time 15 --write-out '\n%{http_code}' \
        -X POST -H @- "${ui_url}/api/auth/refresh"
  )" || return 1
  _companion_extract_token "$response"
}

_companion_extract_token() {
  local response="$1" code
  code="${response##*$'\n'}"
  case "$code" in
    401|403) return 2 ;;
    200) ;;
    *) return 1 ;;
  esac

  printf '%s' "${response%$'\n'*}" | python3 -c '
import json, re, sys
try:
    result = json.load(sys.stdin)
except (TypeError, ValueError):
    sys.exit(1)
token = result.get("token") if isinstance(result, dict) else None
if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~-]+", token):
    sys.exit(1)
print(token)
'
}
