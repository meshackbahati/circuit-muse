# Roadmap

What's shipped, what's underway, what's planned.

---

## Implemented

### Editor

- Monaco Editor with C++ and Python syntax highlighting, autocomplete, minimap, dark theme
- **Multi-file workspace** — create, rename, delete, and switch between `.ino`, `.h`, `.cpp`, `.py`, `.chip.c` files
- **Per-board file groups** — each board on the canvas has its own file set
- Unsaved-changes indicator on file tabs, close-with-confirm dialog
- Resizable file-explorer panel with collapse toggle

### Compilation

- Arduino compilation via `arduino-cli` (AVR, RP2040, ATtiny, ESP32)
- ESP-IDF compilation via `idf.py` with ccache + persistent build dirs (incremental rebuilds in 2–5 s)
- Multi-file sketch support; first `.ino` is promoted to `sketch.ino`
- Compilation console with full toolchain output, warnings, and errors
- Async compile endpoint for long builds (returns a job ID, poll for status)
- Custom-chip compile pipeline (C -> WebAssembly via Emscripten)

### Boards (19, across 5 CPU architectures)

#### AVR8 (browser, avr8js)

- Arduino Uno (ATmega328P @ 16 MHz)
- Arduino Nano (ATmega328P @ 16 MHz)
- Arduino Mega 2560 (ATmega2560 @ 16 MHz)
- ATtiny85 (8 MHz internal / 16 MHz external PLL)

#### RP2040 (browser, rp2040js)

- Raspberry Pi Pico (RP2040 @ 133 MHz)
- Raspberry Pi Pico W (RP2040 + simulated CYW43439 WiFi)

#### Xtensa LX6/LX7 (backend, lcgamboa QEMU)

- ESP32 DevKit V1, ESP32 DevKit C V4
- ESP32-CAM, Wemos Lolin32 Lite
- ESP32-S3 DevKit, XIAO ESP32-S3
- Arduino Nano ESP32

#### RISC-V RV32IMC (backend, lcgamboa QEMU)

- ESP32-C3 DevKit
- XIAO ESP32-C3
- ESP32-C3 SuperMini

#### ARM Cortex-A (backend, upstream QEMU)

- Raspberry Pi Zero (Cortex-A7)
- Raspberry Pi 1B+ (Cortex-A7)
- Raspberry Pi 2B (Cortex-A7)
- Raspberry Pi 3B (Cortex-A53, `raspi3b` machine)
- Raspberry Pi 4B (Cortex-A72)
- Raspberry Pi 5 (Cortex-A76)

### Languages

- **Arduino C++** on every board
- **MicroPython** on Pico / Pico W / all ESP32 / ESP32-S3 / ESP32-C3 variants
- **Python 3** on every Raspberry Pi (real Pi OS Trixie under QEMU)
- **ESP-IDF C** on all ESP32 variants

### Simulation peripherals

- **AVR** — PORTB/C/D, Timer0/1/2, USART (auto baud), ADC, hardware SPI + I2C
- **RP2040** — all 30 GPIO, UART0/UART1, ADC + temp sensor, I2C0/1, SPI0/1, PWM, WFI fast-forward
- **ESP32 (Xtensa)** — 40 GPIO with GPIO32–39 fix, UART0/1/2, ADC (0–3300 mV), I2C, SPI, RMT/NeoPixel, LEDC 16-channel PWM, WiFi (SLIRP NAT), BLE advertising
- **ESP32-C3 (RISC-V)** — GPIO 0–21, UART0, ADC1, WiFi/BLE via same SLIRP path
- **Pi family** — GPIO 0–27 via RPi.GPIO shim over `ttyAMA1`, user Serial on `ttyAMA0`, qcow2 overlay, multi-board UART bridge

### Electrical (analog) simulation

- **ngspice WASM engine** (lazy-loaded, ~39 MB chunk, behind a toolbar toggle)
- **NetlistBuilder** — Union-Find on wires, SPICE card emission per component
- **AVR <-> SPICE bridge** — digital outputs become Thevenin sources, ADCs read solved node voltages
- **ESP32 QEMU <-> SPICE bridge** — same pattern for QEMU backends
- **Analog instruments**: voltmeter, ammeter, oscilloscope (multi-channel + logic analyzer), function generator (sine/square/triangle/sawtooth)
- **Component models**: resistors, capacitors, inductors, diodes (1N4148/4007/Zener/Schottky/LED), transistors (NPN/PNP, MOSFET N/P), op-amps (LM358/TL081/LM741), comparators
- **Mixed-signal sanity** — pot wired to A0 reads the real voltage; op-amp follower between pot and A0 still works

### Custom Chips

- **C-to-WASM** SDK with `vx_*` primitives (GPIO, ADC, DAC, I2C/SPI slave, UART, timers, framebuffer, log)
- **30+ example chips** in the gallery: Intel 4001/4002/4004/4040/8080/8086 + 8251/8253/8255/8259, Z80, 74HC595, CD4094, 24C01, 24LC256, MCP3008, PCF8574, DS3231, 32K/1M ROM, 64K RAM, latch 8282, …
- **In-browser runtime** — `ChipRuntime` per instance, WASI shim, deterministic clock
- **Bus bridges** — I2C slave and SPI slave appear as real peripherals to the MCU
- **Backend variant** — chips can also run inside QEMU for ESP32-bound projects

### Components

- **152+ catalog components** across 11 categories (boards, sensors, displays, input, output, motors, logic, analog, passive, electromech, other)
- Component picker with search, category filters, and live previews
- Drag-and-drop repositioning, 90° rotation
- Property dialog: pin assignment, color, value, protocol selector
- Pin selector for explicit pin-to-board mapping
- Auto-generated metadata from upstream wokwi-elements source + Velxio-native override file

### Wire System

- Click-to-connect wire creation with L-shape preview
- Orthogonal routing, 20px grid snap
- 8 signal-type wire colors (VCC, GND, digital, analog, PWM, I2C, SPI, USART)
- Segment-based wire editing (drag perpendicular to segment orientation)
- Parallel-overlap auto-offset (no overlapping wires)
- Pin overlay with cyan/green hover states
- Auto-recalculation when components move (with retries for async-mounting board pins)

### Multi-Board Canvases

- Multiple boards on the same canvas, each with its own simulator instance, file group, Serial Monitor
- Shared electrical netlist — a wire between two boards is one SPICE node
- UART bridge between boards (TX of A → RX of B)
- Deterministic board IDs (first of a kind gets the bare `boardKind`)

### Serial Monitor

- Live serial output, per-board
- Auto baud-rate detection (reads UBRR for AVR, peripheral registers for RP2040 / ESP32)
- Send-to-RX from the UI
- Autoscroll toggle
- Multi-UART support on ESP32 (UART0/1/2)
- Pi: `ttyAMA0` user serial, `ttyAMA1` reserved for GPIO protocol

### Library Manager

- Browse and install the full Arduino library index from the UI
- Live search, installed tab, version display
- Persists installs in `/root/Arduino` (Docker volume `velxio-arduino-user-libs`)

### Portable Project Persistence

- **`.vlx` file format** — single-file JSON snapshot of boards, file groups, components, wires, VFS contents, electrical-sim state
- Save button = download `.vlx`; Open button = restore
- Versioned for forward compatibility
- **Zero server-side state in OSS** — your projects live wherever you put your `.vlx` files

### Examples Gallery

- **380+ built-in examples** across 7 collections:
  - Circuits (190) — pure analog, mixed-signal, transient demos
  - 100 Days of Code (57)
  - E-Paper Displays (70)
  - Retro Intel/Zilog Processors (43)
  - Analog (15)
  - Digital (7)
  - Pico W WiFi (4)
- Filter by board, category, difficulty
- One-click load into editor

### IoT Gateway

- HTTP proxy bridging a real browser to a simulated ESP32 web server
- AsyncWebServer / WebServer / HTTPClient all reachable from the host

### MCP Server

- **stdio mode** (`backend/mcp_server.py`) — Claude Desktop
- **SSE mode** (`backend/mcp_sse_server.py`, port 8002) — Cursor, web agents
- 7 tools: `compile_project`, `run_project`, `import_wokwi_json`, `export_wokwi_json`, `create_circuit`, `update_circuit`, `generate_code_files`

### Apps

- **Web (OSS + Pro)** — at velxio.dev
- **Desktop (Tauri)** — Pro, 30-day trial, deep-link sign-in, license cache + grace banner, ESP32 QEMU prompt

### Deploy

- Single-container Docker image (`Dockerfile.standalone`) published to GHCR + Docker Hub on push to `master`
- 5 named volumes for fast restarts (arduino libs, user libs, ccache, ESP-IDF build dir, sketch data)
- nginx reverse proxy in front of FastAPI inside the container
- Docker Compose for build-from-source

---

## In Progress

- **Wire validation** — short detection, missing-GND warnings, dangling-pin flags
- **Streaming compile output** — line-buffered toolchain log over WebSocket instead of waiting for the full process to finish
- **Wokwi diagram.json import improvements** — better part-mapping fallbacks for parts not in the Velxio catalog

---

## Planned

### Near-term

- **Undo / redo** — for code edits and canvas changes
- **Breadboard component** — half-size + full-size, auto-rail wiring
- **More boards** — STM32 Blue Pill (Cortex-M3), RP2350 (Pico 2), AVR-DA family, Teensy 4.x

### Mid-term

- **Oscilloscope improvements** — FFT view, persistent traces, math channels
- **Logic analyzer** — protocol decode (I2C, SPI, UART, 1-Wire)
- **TypeDoc-generated API site** — auto-published to GitHub Pages
- **More sensor models** — VL53L0X (ToF), MAX30102 (heart rate), ADS1115 (16-bit ADC)
- **EEPROM emulation** for AVR — persistent read/write across simulation restarts
- **WebGPU canvas** — for projects with 200+ components

### Long-term

- **Multiplayer** — share and co-edit simulations in real time
- **Embedded tutorial system** — step-by-step guided projects inside the editor
- **Mobile / tablet** — responsive layout with touch wiring
- **Hardware-in-the-loop** — bridge a real serial device to a simulated canvas
- **AI Co-pilot** — Pro Max — already in beta on velxio.dev

---

## Recently shipped

- 2026-05 — Retro Intel/Zilog chip collection (17 chips, 2 bundled demos, 2 `/examples` entries)
- 2026-05 — Desktop overlay (welcome page, grace banner, ESP32 QEMU prompt)
- 2026-05 — Landing page "Try Simulator Free Online" CTA + download slot
- 2026-04 — ESP32 IoT gateway (real browser <-> simulated WebServer)
- 2026-04 — Multi-board UART bridge (Arduino <-> ESP32 <-> Pi 3 on the same canvas)
- 2026-03 — ngspice analog co-simulation behind the electrical-sim toggle
- 2026-03 — Custom-chip backend runtime for QEMU ESP32

---

## Contributing

Feature requests, bug reports, and pull requests are welcome at [github.com/davidmonterocrespo24/velxio](https://github.com/davidmonterocrespo24/velxio).

All contributors must sign a Contributor License Agreement (CLA); a CLA check runs automatically on PRs so the dual-licensing (AGPLv3 + Commercial) stays valid.
