# CircuitMuse

<p align="center">
  <img src="app/public/circuit-muse-logo.png" alt="CircuitMuse" width="200">
</p>

<p align="center">
  <a href="https://github.com/meshackbahati/circuit-muse/releases"><img src="https://img.shields.io/github/v/release/meshackbahati/circuit-muse?style=flat-square&logo=github" alt="Release"></a>
  <a href="https://github.com/meshackbahati/circuit-muse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/meshackbahati/circuit-muse?style=flat-square" alt="License"></a>
  <a href="https://github.com/meshackbahati/circuit-muse/actions"><img src="https://img.shields.io/github/actions/workflow/status/meshackbahati/circuit-muse/ci.yml?style=flat-square&label=build" alt="Build Status"></a>
</p>

CircuitMuse is a desktop application for building microcontroller circuits. It provides a canvas with electronic parts, a code editor for each board, a compiler backed by a local Python engine, and simulators for several board families. An assistant can change the canvas, write code, compile, run, inspect output, and repair faults through tools.

Simulation and project data stay on the machine. Releases bundle the desktop shell, the Python engine, and Arduino CLI. Board cores are fetched on first compile, and optional QEMU runtimes are downloaded when those boards are used.

## What is in a session

- A canvas with boards, components, and wires.
- A code editor with separate file groups per board.
- Compile and run controls with an output console.
- A serial monitor for board output and a send field for input.
- An oscilloscope with selectable board pins and trigger modes.
- Electrical verification before a run, which reports shorts, LED overcurrent, resistor overpower, and dark indicators.
- A project store in IndexedDB with autosave, explicit save, project history, and import and export.
- An assistant panel that can work on the circuit through tools.

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

The sidecar files under `src-tauri/binaries/` are empty placeholders in git. Both `build-engine.sh` and the release workflow populate them before Tauri bundles the app.

## Assistant providers

Open the assistant panel from the toolbar and use the gear icon for provider settings. Each provider has its own base URL and API key fields.

The model dropdown is populated by `listModels()` on the configured provider. Manual entry covers endpoints without model discovery. No model catalogue is bundled with the application.

| Provider | Setup |
|----------|-------|
| Ollama | Install Ollama and pull a model. No API key is needed. |
| OpenAI | Add a key from platform.openai.com. |
| Anthropic | Add a key from console.anthropic.com. |
| Google Gemini | Add a key from aistudio.google.com. |
| OpenRouter | Add a key from openrouter.ai. |
| Moonshot | Add a key from the Moonshot console. |
| NVIDIA NIM | Add an NVIDIA API key. The base URL defaults to `https://integrate.api.nvidia.com`. |
| Custom | Any OpenAI-compatible endpoint. |

The assistant can inspect the canvas, list valid boards and components, query pin names, add and remove parts, wire pins, write and read files, check the environment, install cores and libraries, verify the circuit, compile, run, stop, reset, read serial output, and delegate focused work to sub-agents. Sub-agent roles are `planner`, `circuit_designer`, `firmware_engineer`, `debugger`, and `verifier`.

The assistant continues after tool results and stops only after a final answer or when a call repeats without progress. It keeps the chat history with the project.

## Projects

Projects are saved locally in IndexedDB. Autosave runs after canvas, code, or chat changes. Use the Projects button in the toolbar for the project list, or press `Ctrl+S` (`Cmd+S` on macOS) to save immediately. The dialog has a name field, a Save Current button, a New button, an Import button, and a Continue current project button. Each saved entry shows its board count, component count, chat message count, and last change date.

Import accepts `.vlx`, `.zip`, and `.fzz` files. Export writes `.vlx`, `.zip`, `.json`, and `.html` files. The native `.vlx` format keeps boards, file groups, components, wires, and chat history.

## Components and simulation

The component catalogue has more than 150 parts, including resistors, capacitors, inductors, transistors, LEDs, NeoPixels, servos, relays, pushbuttons, sensors, displays, logic gates, and communication chips. The canvas snaps wires to named pins and keeps undo history for changes.

Analog simulation uses ngspice compiled to WebAssembly. Digital and mixed circuits run with the board simulator and shared pin state. Instruments include a voltmeter, ammeter, and oscilloscope.

## Serial monitor

The serial monitor shows output from running boards, detects baud rate, accepts input with several line endings, and supports multiple UART channels on ESP32.

## Project layout

```text
circuit-muse/
  app/          React, Vite, TypeScript application
  engine/       Python FastAPI compile and simulation engine
  src-tauri/    Rust Tauri desktop shell
  scripts/      Build helpers
```

## Troubleshooting

White screen on Linux: force software rendering with the environment variable shown in the install section.

Arduino CLI missing: run `bash scripts/download-deps.sh` or open the setup dialog.

Engine not starting: check that Python 3.12 or newer is available, then run `pip install -r requirements.txt` inside `engine/` and restart the app.

QEMU boards not running: ESP32, STM32, and Raspberry Pi targets need their QEMU runtime. Install it from the board prompt or the setup dialog.

## License

MIT

## Author

[Meshack Bahati Ouma](https://github.com/meshackbahati)

## Credits

Based on [Velxio](https://github.com/davidmonterocrespo24/velxio) by David Montero Crespo. Built on [avr8js](https://github.com/wokwi/avr8js), [rp2040js](https://github.com/wokwi/rp2040js), [wokwi-elements](https://github.com/wokwi/wokwi-elements), [ngspice-wasm](https://github.com/wokwi/ngspice-wasm), [lcgamboa/qemu](https://github.com/lcgamboa/qemu), [Espressif QEMU](https://github.com/espressif/qemu), [Tauri](https://tauri.app), and [Monaco Editor](https://microsoft.github.io/monaco-editor/).
