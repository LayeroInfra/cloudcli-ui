#!/bin/bash
set -euo pipefail
# Канонический рантайм вне Documents — иначе launchd получает Operation not permitted.
exec "$HOME/.local/bin/cloudcli-build-agent"
