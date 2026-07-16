#!/usr/bin/env bash
# Smoke test: run the merged blink binary in qemu-system-riscv32 -M esp32p4.
#
# REQUIREMENTS — none of these is true at 2026-05-06:
#   1. Espressif QEMU fork includes -M esp32p4 (see issue #127, status: To Do).
#   2. qemu-system-riscv32 binary is in PATH.
#
# This script will FAIL today. It exists as a reference for Phase B
# (see autosearch/06_recommendations.md). Re-evaluate when espressif/qemu
# adds hw/riscv/esp32p4.c to esp-develop.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
MERGED="$ROOT/sketches/blink/build/esp32.esp32.esp32p4/blink.ino.merged.bin"

if [ ! -f "$MERGED" ]; then
  echo "[!] $MERGED not found — run scripts/compile.sh first."
  exit 1
fi

QEMU_BIN="${QEMU_RISCV32_BINARY:-qemu-system-riscv32}"
if ! command -v "$QEMU_BIN" >/dev/null; then
  echo "[!] $QEMU_BIN not found in PATH."
  echo "    Install Espressif QEMU fork: https://github.com/espressif/qemu/releases"
  exit 1
fi

echo "[+] Available machines:"
"$QEMU_BIN" -M help | grep -i esp || echo "    (no ESP32 machines listed)"
echo

if ! "$QEMU_BIN" -M help | grep -q esp32p4; then
  echo "[!] -M esp32p4 not supported by this QEMU build."
  echo "    Track: https://github.com/espressif/qemu/issues/127"
  exit 2
fi

echo "[+] Booting $MERGED in QEMU esp32p4 (Ctrl-A X to quit)..."
"$QEMU_BIN" \
  -nographic \
  -M esp32p4 \
  -drive "file=$MERGED,if=mtd,format=raw" \
  -serial mon:stdio
