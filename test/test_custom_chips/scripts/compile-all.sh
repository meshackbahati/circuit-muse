#!/usr/bin/env bash
# Compile every example chip in sdk/examples/*.c to fixtures/*.wasm
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p fixtures

for src in sdk/examples/*.c; do
  name="$(basename "$src" .c)"
  out="fixtures/${name}.wasm"
  bash scripts/compile-chip.sh "$src" "$out"
done

echo ""
echo "All examples compiled. Fixtures in: fixtures/"
ls -la fixtures/*.wasm
