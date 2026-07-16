#!/usr/bin/env bash
# Compile the bare-metal ESP32-C3 blink program using the riscv32-esp-elf-gcc
# toolchain that ships with the arduino-cli ESP32 package.
#
# Output:
#   blink.elf  — ELF with debug info
#   blink.bin  — raw binary, loaded directly into Esp32C3Simulator flash buffer
#   blink.dis  — disassembly for debugging

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Locate toolchain ──────────────────────────────────────────────────────────
ARDUINO15="${LOCALAPPDATA:-$HOME/.arduino15}/Arduino15"
TOOLCHAIN_BASE="$ARDUINO15/packages/esp32/tools/riscv32-esp-elf-gcc"

if [ ! -d "$TOOLCHAIN_BASE" ]; then
  echo "ERROR: ESP32 RISC-V toolchain not found at $TOOLCHAIN_BASE"
  echo "Install with: arduino-cli core install esp32:esp32"
  exit 1
fi

# Pick the newest version directory
TOOLCHAIN_VER=$(ls "$TOOLCHAIN_BASE" | sort -V | tail -1)
TOOLCHAIN_BIN="$TOOLCHAIN_BASE/$TOOLCHAIN_VER/bin"

GCC="$TOOLCHAIN_BIN/riscv32-esp-elf-gcc"
OBJCOPY="$TOOLCHAIN_BIN/riscv32-esp-elf-objcopy"
OBJDUMP="$TOOLCHAIN_BIN/riscv32-esp-elf-objdump"

if [ ! -f "$GCC.exe" ] && [ ! -f "$GCC" ]; then
  echo "ERROR: riscv32-esp-elf-gcc not found in $TOOLCHAIN_BIN"
  exit 1
fi

# On Windows inside Git Bash, .exe is appended automatically
GCC="${GCC}.exe"      2>/dev/null || GCC="$GCC"
OBJCOPY="${OBJCOPY}.exe" 2>/dev/null || OBJCOPY="$OBJCOPY"
OBJDUMP="${OBJDUMP}.exe" 2>/dev/null || OBJDUMP="$OBJDUMP"

echo "Toolchain: $TOOLCHAIN_BIN"
echo "Compiler:  $GCC"

# ── Compile ───────────────────────────────────────────────────────────────────
"$GCC" \
  -march=rv32imc \
  -mabi=ilp32 \
  -Os \
  -ffunction-sections \
  -fdata-sections \
  -nostdlib \
  -nostartfiles \
  -T "$SCRIPT_DIR/link.ld" \
  -Wl,--gc-sections \
  -o "$SCRIPT_DIR/blink.elf" \
  "$SCRIPT_DIR/blink.c"

# ── Extract raw binary (flash offset 0 → loads at IROM_BASE 0x42000000) ───────
"$OBJCOPY" -O binary "$SCRIPT_DIR/blink.elf" "$SCRIPT_DIR/blink.bin"

# ── Disassembly for inspection ─────────────────────────────────────────────────
"$OBJDUMP" -d -M numeric "$SCRIPT_DIR/blink.elf" > "$SCRIPT_DIR/blink.dis"

BIN_SIZE=$(wc -c < "$SCRIPT_DIR/blink.bin" | tr -d ' ')
echo ""
echo "✓ blink.bin  — ${BIN_SIZE} bytes"
echo "✓ blink.dis  — disassembly"
echo ""
echo "Entry point: 0x42000000  (first instruction in flash)"
