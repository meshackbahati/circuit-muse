#!/usr/bin/env bash
# Compile every chip source under test_*/  into  fixtures/<name>.wasm.
# A chip source is any  test_<chip>/<chip>.c  or  test_buses/<name>.c.
#
# Usage:  bash scripts/compile-all.sh
#
# Skips chips whose .c source does not exist yet (TDD-friendly — most
# of the per-chip folders only have a README at first).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

mkdir -p "$ROOT/fixtures"

found=0
compiled=0

shopt -s nullglob
for c_source in "$ROOT"/test_*/*.c "$ROOT"/test_buses/*.c; do
  found=$((found+1))
  base="$(basename "$c_source" .c)"
  out="$ROOT/fixtures/$base.wasm"
  echo "▸ compiling $base"
  if bash "$HERE/compile-chip.sh" "$c_source" "$out"; then
    compiled=$((compiled+1))
  else
    echo "  ✗ failed to compile $base"
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No chip sources found yet. Drop a <chip>.c into a test_*/ folder."
  exit 0
fi

echo
echo "Compiled $compiled / $found chip(s) to fixtures/"
