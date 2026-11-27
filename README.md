# CircuitMuse

<p align="center">
  <img src="app/public/circuit-muse-logo.png" alt="CircuitMuse" width="200">
</p>

<p align="center">
  <a href="https://github.com/meshackbahati/circuit-muse/releases"><img src="https://img.shields.io/github/v/release/meshackbahati/circuit-muse?style=flat-square&logo=github" alt="Release"></a>
  <a href="https://github.com/meshackbahati/circuit-muse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/meshackbahati/circuit-muse?style=flat-square" alt="License"></a>
  <a href="https://github.com/meshackbahati/circuit-muse/actions"><img src="https://img.shields.io/github/actions/workflow/status/meshackbahati/circuit-muse/ci.yml?style=flat-square&label=build" alt="Build Status"></a>
</p>

CircuitMuse is a desktop application for building microcontroller circuits. The workspace holds a canvas with electronic parts, a code editor with one file group per board, a compiler backed by a local Python engine, and simulators for several board families. An assistant can inspect and change the canvas, write firmware, compile, run, read serial output, repair faults, and flash a compiled image to a physical board. Simulation and project data stay on the machine.

Release packages bundle the desktop shell, the Python engine, and Arduino CLI. Board cores are fetched on first compile, and QEMU runtimes are downloaded when a QEMU board is used.

## What is in a session

- A canvas with boards, components, wires with waypoints, undo and redo, and pin overlays.
- A code editor with independent file groups. Each board owns its source files.
- Compile, Compile All, Run, Run All, Stop, and Reset controls with an output console.
- Electrical verification that reports shorts, LED overcurrent, resistor overpower, and dark indicators.
- A serial monitor with baud detection, input with several line endings, and multiple UART channels on ESP32.
- An oscilloscope that monitors any board and pin, measures frequency and duty, exposes trigger modes and capture, and renders at a bounded redraw rate.
- Instruments for voltage and current, plus interactive parts such as pushbuttons, switches, potentiometers, keypads, encoders, and I2C displays that respond to pointer input while the simulation runs.
- A hardware flash dialog that enumerates USB ports, shows readable board names, supports custom port labels, and streams upload progress.
- Projects in IndexedDB with autosave, explicit save, history, import, and export.
- A docked assistant panel that can be resized, minimized, or closed, with searchable history and pasted or dropped attachments.

## Supported boards

| Board | CPU | Simulator |
|-------|-----|-----------|
| Arduino Uno, Nano, Mega 2560 | ATmega328P, ATmega2560 | avr8js |
| ATtiny85 | ATtiny85 | avr8js |
| Raspberry Pi Pico and Pico W | RP2040 | rp2040js |
| ESP32 DevKit, CAM, Lolin32 | Xtensa LX6 | QEMU |
| ESP32-S3 and XIAO ESP32-S3 | Xtensa LX7 | QEMU |
| ESP32-C3 and SuperMini | RISC-V RV32IMC | QEMU |
| STM32 Blue Pill and Nucleo | ARM Cortex-M3 | QEMU |
| Raspberry Pi 3B, 4B, 5 | ARM Cortex-A | QEMU |

Release packages are produced for Windows x64, macOS Apple Silicon, and Linux x64. Linux formats are `.deb`, `.rpm`, `.pkg.tar.zst`, and `.AppImage`.

## Install

Download a package from [GitHub Releases](https://github.com/meshackbahati/circuit-muse/releases).

| Platform | Format | Install |
|----------|--------|---------|
| Windows | `.msi` or `.exe` | Run the installer |
| macOS | `.dmg` | Drag to Applications |
| Ubuntu and Debian | `.deb` | `sudo dpkg -i circuit-muse_*.deb` |
| Arch | `.pkg.tar.zst` | `sudo pacman -U circuit-muse-*.pkg.tar.zst` |
| Fedora | `.rpm` | `sudo dnf install ./circuit-muse-*.rpm` |
| Any Linux | `.AppImage` | `chmod +x CircuitMuse_*.AppImage && ./CircuitMuse_*.AppImage` |

The app opens straight into the editor. A setup dialog appears on first launch and reports which tools are present.

The AppImage needs WebKit2GTK 4.1 and GTK 3 on the host. Software rendering is selected automatically when no GPU render device is found. To force it:

```bash
CIRCUIT_MUSE_SOFTWARE_RENDERING=1 ./CircuitMuse_*.AppImage
```

## Multi-board circuits

A circuit can hold several boards of different families. The canvas header selects the active board, which switches the file explorer to that board's group. Compile acts on the active board; Compile All builds one image per board from its own files. Run All starts every compiled board, and Stop cuts power to all of them. The toolbar Stop calls `stopAllBoards`, so a stale per-board flag cannot leave a board running.

The oscilloscope is board-aware. A channel is a `(board id, pin)` pair, so pin 13 on two boards is tracked separately. The first channel is chosen from the pins the sketch actually drives, and the timebase is set from the sketch delays, which avoids a permanent "waiting for signal" display. The panel provides frequency and duty readouts, rising and falling triggers, single-shot capture, an expanded view, quick channel addition, and a time/div selector.

## The assistant

Open the assistant panel from the toolbar and use the gear icon for provider settings. Each provider has its own base URL and API key fields.

The model list comes from `listModels()` on the configured provider. Manual entry covers endpoints without discovery, and no model catalogue is bundled.

| Provider | Setup |
|----------|-------|
| Ollama | Install Ollama and pull a model. No API key is needed. |
| OpenAI | Add a key from platform.openai.com. |
| Anthropic | Add a key from console.anthropic.com. |
| Google Gemini | Add a key from aistudio.google.com. Gemini 3 requires thought signatures, which the bundled GenAI SDK handles. |
| OpenRouter | Add a key from openrouter.ai. |
| Moonshot | Add a key from the Moonshot console. |
| NVIDIA NIM | Add an NVIDIA API key. The base URL defaults to `https://integrate.api.nvidia.com`. |
| Custom | Any OpenAI-compatible endpoint. |

NVIDIA NIM requests are relayed through the local engine at `/api/ai/nvidia` because NVIDIA sends no CORS headers to the desktop WebView. The relay accepts only `https://integrate.api.nvidia.com/v1/` destinations. Anthropic requests carry the `anthropic-dangerous-direct-browser-access` header. Ollama is local, and its origin policy must include the desktop origin if it has been restricted.

### How the assistant builds a circuit

The assistant works in stages: inspect, build and wire, write code, verify electrically, compile, run, observe, debug, and report. The tool layer enforces the ordering because prompt order alone is not sufficient.

- `get_circuit_state` returns boards, components, wires, and wiring status. `list_available_boards`, `list_available_components`, and `get_pin_names` supply valid identifiers.
- `build_circuit` adds many parts and wires in one call using short refs. `add_component` and `wire_components` handle smaller edits.
- `check_wiring` audits every part. A part passes only when its required pins are connected, its wire endpoints resolve, and the board has a ground connection. The audit reports missing pins, orphan wires, and the next actions.
- `compile_code`, `compile_all_code`, and `run_simulation` refuse to proceed while the audit reports blocking issues. This prevents firmware from being written before the circuit is wired.
- `compile_code` and `compile_all_code` accept `run_after` and `observe_ms`, which combine compile, start, and serial capture in one call. `get_simulation_output` accepts `wait_ms`.
- `verify_circuit` runs before the run to catch shorts and overcurrent.
- A completion gate in the chat service inspects the live stores before accepting a final answer. It sends the assistant back to wiring, compiling, running, or reading serial output when a stage is missing, and it refuses stale firmware after a source change.
- Repeated inspection tools are limited to three calls per turn, which prevents a compile and verify loop.
- Stop aborts the provider stream and any running tool, and clears the streaming state on the same click. Synthetic tool results keep the transcript valid after an abort.

The ordering, hard gates, abort path, and provider handling are described in [docs/agent-workflow.md](docs/agent-workflow.md).

The full tool set is `get_circuit_state`, `list_available_boards`, `list_available_components`, `get_pin_names`, `add_board`, `remove_board`, `add_component`, `build_circuit`, `remove_component`, `set_component_property`, `wire_components`, `remove_wire`, `check_wiring`, `verify_circuit`, `update_code`, `read_code`, `compile_code`, `compile_all_code`, `get_compile_output`, `run_simulation`, `stop_simulation`, `reset_simulation`, `get_simulation_output`, `check_environment`, `install_firmware`, `install_library`, `search_libraries`, `get_installed_libraries`, `set_board_language`, `list_uploaded_files`, `read_uploaded_file`, and `delegate_to_subagent`.

Sub-agent roles are `planner`, `circuit_designer`, `firmware_engineer`, `debugger`, and `verifier`. The assistant continues after tool results, retries provider 503 and busy responses with backoff, compacts long histories into a factual summary, and balances Gemini function call and response parts. Tool calls use native function parts, so Gemini continues executing tools instead of describing them in prose.

Use Attach file in the assistant panel to add text files, images, PDFs, or DOCX documents. The assistant reads them through `list_uploaded_files` and `read_uploaded_file`. Chat history is saved with the project.

## Projects

Projects are saved locally in IndexedDB. Autosave runs after canvas, code, or chat changes. Use the Projects button in the toolbar for the project list. `Ctrl+S` (`Cmd+S` on macOS) opens the save dialog with the current name. `Ctrl+Shift+S` opens it with a new project id. Each saved entry shows its board count, component count, chat message count, and last change date.

Import accepts `.vlx`, `.zip`, and `.fzz` files. Export writes `.vlx`, `.zip`, `.json`, and `.html` files. The native `.vlx` format keeps boards, file groups, components, wires, and chat history.

## Components and simulation

The catalogue has more than 150 parts, including resistors, capacitors, inductors, transistors, LEDs, NeoPixels, servos, relays, pushbuttons, sensors, displays, logic gates, and communication chips. Wires snap to named pins and support waypoints so they can route around parts.

Analog simulation uses ngspice compiled to WebAssembly. Digital and mixed circuits run with the board simulator and shared pin state. Digital inputs follow SPICE-solved net voltages, so buttons, direct 5 V wires, and dividers reach `digitalRead()`. Parts wired to a non-active board drive that board's pin registers. Simulation frames are time-sliced and serial buffers, transcripts, and sample buffers are bounded, which keeps the app usable on a 4 GB laptop.

## Hardware flashing

A compiled board can be flashed to a physical USB board. The lightning button in the canvas header and the board context menu both open the flash dialog. The dialog enumerates serial ports through the Tauri `list_serial_ports` command, which returns the vendor id, product id, manufacturer, product, and serial number. Ports are shown with readable names such as `Arduino Uno (/dev/ttyACM0)` or `CH340 USB serial (COM3)`, and a `Name this port` control stores a custom label locally.

The frontend posts the compiled program to `/api/flash/upload` on the local engine with the port, FQBN, and program format. The engine writes a temporary file with the extension the uploader expects and runs `arduino-cli upload -p PORT -i FILE --fqbn FQBN -v`. Arduino CLI selects the uploader from the FQBN: avrdude for AVR, picotool for RP2040, and esptool for ESP32. Upload output streams back as server-sent events and drives the progress bar. One flash runs per port at a time. The web build cannot enumerate local serial ports, so flash controls are hidden outside the desktop shell.

On Linux, ports appear as `/dev/ttyACM*` or `/dev/ttyUSB*` and the user must belong to the `dialout` group. On macOS, ports appear as `/dev/cu.usbmodem*` or `/dev/cu.usbserial*` and adapter chips need a vendor driver. On Windows, ports appear as `COM*` and a vendor driver is required. See [docs/hardware-flashing.md](docs/hardware-flashing.md) for details and limitations.

## Build from source

Prerequisites are Node.js 20 or newer, Python 3.12 or newer, Rust stable, and the WebKit2GTK development packages for the target platform.

On Ubuntu or Debian:

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libssl-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libudev-dev
```

On Arch:

```bash
sudo pacman -S webkit2gtk-4.1 appmenu-gtk-module libappindicator-gtk3 \
  librsvg patchelf openssl gtk3 libsoup3
```

On Fedora:

```bash
sudo dnf install -y gcc webkit2gtk4.1-devel gtk3-devel libsoup3-devel \
  patchelf openssl-devel
```

Then build:

```bash
git clone https://github.com/meshackbahati/circuit-muse.git
cd circuit-muse

cd app && npm install && cd ..
cd engine && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && cd ..

bash scripts/download-deps.sh
bash scripts/build-engine.sh

cargo install tauri-cli --version "^2"
cd src-tauri && cargo tauri build
```

Packages appear under `src-tauri/target/release/bundle/`. For development, run `cargo tauri dev` from `src-tauri`.

The sidecar files under `src-tauri/binaries/` are empty placeholders in git. Both `build-engine.sh` and the release workflow populate them before Tauri bundles the app. Restore them with `git checkout -- src-tauri/binaries/...` after a local install. The AppImage step may fail locally when `linuxdeploy` cannot run; the CI release jobs produce the published AppImage.

## Project layout

```text
circuit-muse/
  app/          React, Vite, TypeScript application
  engine/       Python FastAPI compile, AI relay, and flash engine
  src-tauri/    Rust Tauri desktop shell and serial port command
  scripts/      Build helpers
  docs/         Hardware flashing and UI notes
```

## Troubleshooting

White screen on Linux: force software rendering with the environment variable shown in the install section.

Arduino CLI missing: run `bash scripts/download-deps.sh` or open the setup dialog.

Engine not starting: check that Python 3.12 or newer is available, then run `pip install -r requirements.txt` inside `engine/` and restart the app.

QEMU boards not running: ESP32, STM32, and Raspberry Pi targets need their QEMU runtime. Install it from the board prompt or the setup dialog.

No serial ports in the flash dialog: attach a board by USB. On Linux add the user to `dialout` and log out and back in. On macOS and Windows install the adapter driver.

Assistant returns HTTP 400 with `exception parsing response`: start a new chat. Long or corrupted transcripts with mismatched tool turns can be rejected; the app compacts history and retries, but a fresh chat is the reliable recovery. If the error occurs again in a fresh chat with Gemini, confirm that the configured model supports function calling.

## License

MIT

## Author

[Meshack Bahati Ouma](https://github.com/meshackbahati)

## Credits

Based on [Velxio](https://github.com/davidmonterocrespo24/velxio) by David Montero Crespo. Built on [avr8js](https://github.com/wokwi/avr8js), [rp2040js](https://github.com/wokwi/rp2040js), [wokwi-elements](https://github.com/wokwi/wokwi-elements), [ngspice-wasm](https://github.com/wokwi/ngspice-wasm), [lcgamboa/qemu](https://github.com/lcgamboa/qemu), [Espressif QEMU](https://github.com/espressif/qemu), [Tauri](https://tauri.app), and [Monaco Editor](https://microsoft.github.io/monaco-editor/).
