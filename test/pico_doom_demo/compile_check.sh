#!/usr/bin/env bash
# Pre-flight compile check for the Pico Doom raycaster example.
#
# Runs arduino-cli against the same FQBN the Velxio backend uses for the
# Raspberry Pi Pico and exits 0 only if the sketch builds cleanly with
# the gallery's auto-installed library set.
#
# Manual use:
#   cd test/pico_doom_demo && ./compile_check.sh
#
# This file is wired into the test/ tree (not the vitest suite) because
# arduino-cli isn't available in the CI image we use for the JS tests;
# the operator runs it before merging the example, the in-repo unit
# test verifies the example data shape.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKETCH_DIR="$SCRIPT_DIR"
BOARD_FQBN="rp2040:rp2040:rpipico"
BUILD_DIR="$SCRIPT_DIR/build"

echo "─── Pico Doom compile check ───────────────────────────────"

if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "ERROR: arduino-cli not on PATH. Install from https://arduino.github.io/arduino-cli/"
  exit 1
fi

# Make sure the Pico core is installed. earlephilhower/arduino-pico is
# what the production Velxio backend pulls.
if ! arduino-cli core list 2>/dev/null | grep -q "rp2040:rp2040"; then
  echo "[install] adding rp2040:rp2040 core index"
  arduino-cli config add board_manager.additional_urls \
    https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json \
    || true
  arduino-cli core update-index
  arduino-cli core install rp2040:rp2040
fi

# Confirm required libs exist; install if absent.
for lib in "Adafruit GFX Library" "Adafruit ILI9341"; do
  if ! arduino-cli lib list 2>/dev/null | grep -q "$lib"; then
    echo "[install] adding library: $lib"
    arduino-cli lib install "$lib"
  fi
done

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "[compile] $BOARD_FQBN"
arduino-cli compile \
  --fqbn "$BOARD_FQBN" \
  --output-dir "$BUILD_DIR" \
  "$SKETCH_DIR"

uf2_path=$(find "$BUILD_DIR" -name '*.uf2' | head -n1 || true)
if [ -z "$uf2_path" ] || [ ! -s "$uf2_path" ]; then
  echo "ERROR: no .uf2 produced — compile output above"
  exit 1
fi

uf2_kb=$(($(stat -c%s "$uf2_path") / 1024))
echo "[ok] built $(basename "$uf2_path")  (${uf2_kb} KB)"
echo "──────────────────────────────────────────────────────────"
