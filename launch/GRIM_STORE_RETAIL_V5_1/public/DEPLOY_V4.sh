#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
rm -rf "$REPO/public"
cp -R "$ROOT/public" "$REPO/public"
mkdir -p "$REPO/src"
cp "$ROOT/src/server.js" "$REPO/src/server.js"
echo "GRIM V4 installed."
