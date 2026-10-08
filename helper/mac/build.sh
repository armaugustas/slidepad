#!/bin/sh
# Builds a universal (Apple silicon + Intel) helper binary into docs/helper/, where GitHub Pages serves it.
set -eu
cd "$(dirname "$0")"
OUT=../../docs/helper/slidepad-mac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -target "$arch-apple-macos12" main.swift -o "$TMP/slidepad-$arch"
done
lipo -create "$TMP/slidepad-arm64" "$TMP/slidepad-x86_64" -output "$OUT"
codesign --force --sign - "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
