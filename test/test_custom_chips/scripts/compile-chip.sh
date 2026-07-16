#!/usr/bin/env bash
# Compile a Velxio custom chip from C → WASM.
# Usage:
#   bash scripts/compile-chip.sh <input.c> <output.wasm>
#
# Requires: WASI_SDK env var pointing to the wasi-sdk install
# (see scripts/setup-wasi-sdk.md).

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <input.c> <output.wasm>"
  exit 64
fi

INPUT="$1"
OUTPUT="$2"

if [ -z "${WASI_SDK:-}" ]; then
  for candidate in /opt/wasi-sdk /usr/local/wasi-sdk "$HOME/wasi-sdk"; do
    if [ -d "$candidate" ]; then WASI_SDK="$candidate"; break; fi
  done
fi

if [ -z "${WASI_SDK:-}" ] || [ ! -x "$WASI_SDK/bin/clang" ]; then
  echo "ERROR: wasi-sdk not found. Set WASI_SDK env var."
  echo "See scripts/setup-wasi-sdk.md for installation instructions."
  exit 1
fi

SDK_INCLUDE="$(dirname "$0")/../sdk/include"

mkdir -p "$(dirname "$OUTPUT")"

"$WASI_SDK/bin/clang" \
  --target=wasm32-unknown-wasip1 \
  -O2 \
  -nostartfiles \
  -Wl,--import-memory \
  -Wl,--export-table \
  -Wl,--no-entry \
  -Wl,--export=chip_setup \
  -Wl,--allow-undefined \
  -I"$SDK_INCLUDE" \
  "$INPUT" \
  -o "$OUTPUT"

echo "✓ $OUTPUT ($(wc -c < "$OUTPUT") bytes)"
