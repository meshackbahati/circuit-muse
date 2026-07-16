# ESP32 Emulation Test Suite

This directory contains tests for ESP32 emulation using QEMU compiled to WebAssembly.

## Structure

- `sketches/` - Arduino sketches for ESP32 (copied from test/esp32/sketches)
- `binaries/` - Compiled firmware binaries (`.bin`, `.elf`)
- `qemu-config/` - QEMU machine configurations
- `scripts/` - Build and test scripts
- `web/` - HTML/JS wrapper for WebAssembly QEMU

## Prerequisites

1. QEMU fork built as WebAssembly (see `third-party/qemu-lcgamboa/`)
2. ESP32 toolchain (arduino-cli with esp32 platform)
3. Emscripten SDK (for building QEMU to WASM)

## Initial Test

The first test is to compile the blink sketch and run it in QEMU (native) to verify basic GPIO emulation.

## Goals

- Emulate GPIO pins (digitalWrite, digitalRead)
- Emulate Serial output (UART)
- Emulate WiFi (station and AP modes)
- Emulate other peripherals (SPI, I2C, ADC, etc.)
- Run entirely in browser via WebAssembly