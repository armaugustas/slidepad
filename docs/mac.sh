#!/bin/sh
# Slidepad helper for macOS.
#   curl -fsSL https://armaugustas.github.io/slidepad/mac.sh | sh
# Downloads the helper into a temporary folder, runs it, and deletes it when you stop it.
# Nothing is installed and nothing starts at login.
set -eu
BASE="${SLIDEPAD_BASE:-https://armaugustas.github.io/slidepad}"
DIR="$(mktemp -d -t slidepad)"
trap 'rm -rf "$DIR"' EXIT INT TERM

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This is the macOS helper. On Windows, run in PowerShell:  irm $BASE/win.txt | iex"
  exit 1
fi

echo "  Downloading Slidepad helper…"
curl -fsSL "$BASE/helper/slidepad-mac" -o "$DIR/slidepad-helper"
chmod +x "$DIR/slidepad-helper"
"$DIR/slidepad-helper" "$@"
