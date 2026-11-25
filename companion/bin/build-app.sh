#!/bin/bash
# Compile the Cocoa host into Companion.app/Contents/MacOS/companion
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app/CompanionApp"
OUT="$ROOT/app/Companion.app/Contents/MacOS/companion"
mkdir -p "$(dirname "$OUT")"
swiftc -O -o "$OUT" "$SRC"/*.swift -framework AppKit
chmod 755 "$OUT"
echo "built $OUT"
file "$OUT"
