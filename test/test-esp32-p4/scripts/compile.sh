#!/usr/bin/env bash
# Compile the blink sketch for ESP32-P4 with arduino-cli.
# Reproduces the test documented in autosearch/03_compilation_test.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
SKETCH="$ROOT/sketches/blink"

echo "[+] Compiling $SKETCH for esp32:esp32:esp32p4"
arduino-cli compile --fqbn esp32:esp32:esp32p4 "$SKETCH"

BUILD="$SKETCH/build/esp32.esp32.esp32p4"
echo "[+] Output:"
ls -la "$BUILD"
echo
echo "[+] ELF arch:"
file "$BUILD/blink.ino.elf"
