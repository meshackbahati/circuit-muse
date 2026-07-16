# CircuitMuse — AI-Powered Circuit & Embedded Board Simulator

A fully local, open-source multi-board emulator with an integrated AI agent. Write Arduino C++ or Python, compile it, simulate it with real CPU emulation and 100+ interactive electronic components — and chat with an AI to design circuits, debug code, and wire components — all running on your desktop.

**31 boards · 6 CPU architectures**: AVR8 (ATmega / ATtiny), ARM Cortex-M0+ (RP2040), Xtensa LX6/LX7 (ESP32 via QEMU), RISC-V RV32IMC (ESP32-C3 via QEMU), ARM Cortex-M (STM32 via QEMU), and ARM Cortex-A (Raspberry Pi 3/4/5 Linux via QEMU).

---

## What is CircuitMuse?

CircuitMuse is a fork of [Velxio](https://github.com/davidmonterocrespo24/velxio) by David Montero Crespo. We are grateful for the incredible work David and the Velxio community have built — the multi-board emulation engine, the component system, and the SPICE integration are remarkable achievements.

CircuitMuse extends Velxio with:

- **AI Agent Chat Panel** — talk to your circuit in natural language. Ask the AI to place components, wire them, write firmware, compile, and debug — all through a chat interface
- **Multi-Provider AI** — bring your own API key. OpenAI, Anthropic, Ollama (local), Google Gemini, OpenRouter, Moonshot, or any OpenAI-compatible endpoint. Use multiple providers in the same session
- **Desktop Application** — native Tauri desktop app for Windows, macOS, and Linux. Everything works offline, no account required
- **Fully Open Source** — MIT license. No paywalls, no gating, no commercial tier. Every feature is free forever

---

## Quick Start

### Desktop App (Recommended)

Download the latest release for your platform from [Releases](https://github.com/your-username/circuit-muse/releases). Install and run — no setup needed.

### Web (Self-Host)

```bash
docker run -d \
  --name circuit-muse \
  -p 3080:80 \
  -v circuit-muse-data:/app/data \
  -v circuit-muse-arduino-libs:/root/.arduino15 \
  -v circuit-muse-arduino-user-libs:/root/Arduino \
  -v circuit-muse-ccache:/var/cache/ccache \
  -v circuit-muse-build:/var/lib/velxio-build \
  ghcr.io/your-username/circuit-muse:latest
```

Then open <http://localhost:3080>.

### Development

```bash
git clone https://github.com/your-username/circuit-muse.git
cd circuit-muse

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

---

## Features

### AI Agent

- **Natural language circuit design** — "Add an Arduino Uno and wire an LED to pin 13"
- **Multi-provider support** — OpenAI, Anthropic, Ollama, Google, OpenRouter, Moonshot, custom endpoints
- **Bring Your Own Key** — your API keys stay on your machine, never sent to us
- **File upload** — share screenshots, code files, or .vlx projects with the AI
- **Auto-diagnose** — when compilation fails, click "Diagnose with AI" to get instant help
- **Tool calling** — the AI can directly place components, wire circuits, write code, and run simulations

### Code Editing

- **Monaco Editor** — full C++ / Python editor with syntax highlighting, autocomplete, and dark theme
- **Multi-file workspace** — create, rename, delete, and switch between multiple `.ino` / `.h` / `.cpp` / `.py` files
- **Arduino compilation** via `arduino-cli` backend — compile sketches to `.hex` / `.bin` files
- **Compile / Run / Stop / Reset** toolbar buttons with status messages
- **Compilation console** — resizable output panel showing full compiler output, warnings, and errors

### Multi-Board Simulation

**31 boards across 6 CPU architectures:**

| Board | CPU | Engine |
| ----- | --- | ------ |
| Arduino Uno / Nano / Mega 2560 | ATmega328p / ATmega2560 | avr8js (browser) |
| ATtiny85 | ATtiny85 | avr8js (browser) |
| Raspberry Pi Pico / Pico W | RP2040 | rp2040js (browser) |
| ESP32 DevKit / DevKit C / CAM / Lolin32 | Xtensa LX6 | QEMU (backend) |
| ESP32-S3 / XIAO ESP32-S3 / Nano ESP32 | Xtensa LX7 | QEMU (backend) |
| ESP32-C3 / XIAO ESP32-C3 / SuperMini | RISC-V RV32IMC | QEMU (backend) |
| STM32 Blue Pill / Black Pill / F4 Discovery | ARM Cortex-M3/M4 | QEMU (backend) |
| Raspberry Pi 3B / 4B / 5 | ARM Cortex-A53/A72/A76 | QEMU + Linux (backend) |

### Component System (100+ Components)

LEDs, resistors, capacitors, transistors, op-amps, logic gates, servos, motors, sensors (DHT22, HC-SR04, BMP280, MPU6050), displays (OLED, LCD, TFT, E-Paper), NeoPixels, relays, potentiometers, pushbuttons, switches, buzzers, and more.

### Electrical Simulation (SPICE)

- **ngspice-WASM** — real SPICE analog simulation in the browser
- **Mixed-mode** — digital MCU + analog circuits in the same simulation
- **Instruments** — voltmeter, ammeter, oscilloscope
- **44+ SPICE component models** — resistors, capacitors, diodes, transistors, op-amps

### Wire System

- **Pin-to-pin wiring** with orthogonal routing
- **20+ wire colors** with auto-color by signal type
- **Segment editing** — drag wire segments perpendicular to their orientation

### Canvas Features

- **Pan and zoom** (mouse wheel, pinch)
- **Component rotation** (90° increments)
- **Drag-and-drop** positioning
- **Minimap** for navigation
- **Undo/redo** (50-step history)
- **Right-click context menus**

### Serial Monitor

- **Live serial output** — characters as the sketch sends them
- **Auto baud-rate detection** — no manual configuration needed
- **Send data** to the RX pin from the UI

### Project Persistence

- **`.vlx` file format** — single-file JSON snapshot of the whole workspace
- **Zero server-side state** — your projects live on your machine
- **Wokwi zip import** — import existing Wokwi projects

### Example Projects

100+ built-in examples covering basics, sensors, displays, communication, robotics, and more.

---

## Desktop App

CircuitMuse runs as a native desktop application via [Tauri](https://tauri.app):

- **Windows** — `.msi` and `.nsis` installers
- **macOS** — `.dmg` disk image (Intel + Apple Silicon)
- **Linux** — `.deb`, `.AppImage`, and `.rpm` packages
- **Auto-update** — built-in update checking and installation
- **Serial port access** — enumerate and connect to USB serial devices
- **Native menus** — File, Edit, View, Help menus with keyboard shortcuts
- **QEMU integration** — auto-download ESP32/STM32 QEMU runtimes on first use

---

## AI Agent Setup

The AI agent supports multiple LLM providers. Configure in **Settings** (gear icon in the chat panel):

| Provider | Setup |
|----------|-------|
| **OpenAI** | Paste your API key from [platform.openai.com](https://platform.openai.com) |
| **Anthropic** | Paste your API key from [console.anthropic.com](https://console.anthropic.com) |
| **Ollama** (local) | Install [Ollama](https://ollama.com), run `ollama pull llama3`, no API key needed |
| **Google Gemini** | Paste your API key from [aistudio.google.com](https://aistudio.google.com) |
| **OpenRouter** | Paste your API key from [openrouter.ai](https://openrouter.ai) |
| **Moonshot** | Paste your API key from [platform.moonshot.cn](https://platform.moonshot.cn) |
| **Custom** | Any OpenAI-compatible endpoint (e.g. LM Studio, vLLM, text-generation-webui) |

Your API keys are stored locally in your browser's localStorage (web) or desktop app config. They are never sent to any CircuitMuse server.

---

## Supported Boards

See the full board table and emulation details in the [Architecture documentation](docs/ARCHITECTURE.md).

---

## Self-Hosting

| Path | Best for |
| --- | --- |
| **Docker (prebuilt)** | Just want it running |
| **Docker Compose (build)** | Want to modify the code |
| **Manual install** | Frontend / backend development |

See [docs/getting-started.md](docs/getting-started.md) for detailed setup instructions.

---

## Project Structure

```text
circuit-muse/
├── frontend/                    # React + Vite + TypeScript
│   ├── src-tauri/              # Tauri desktop shell (Rust)
│   └── src/
│       ├── agent/              # AI agent chat panel
│       ├── components/         # Editor, simulator canvas, modals
│       ├── simulation/         # AVR8, RP2040, ESP32, STM32, Pi bridges
│       ├── store/              # Zustand stores
│       └── services/           # API clients, LLM provider service
├── backend/                     # FastAPI + Python
│   └── app/
│       ├── api/routes/         # compile, agent, libraries, simulation
│       ├── agent/              # Agent tools, system prompt, LLM registry
│       ├── services/           # arduino_cli, esp32_worker, llm_provider
│       └── core/               # config
├── docs/                        # Technical documentation
├── Dockerfile.standalone        # Single-container Docker image
└── docker-compose.yml           # Self-hosting compose
```

---

## License

**MIT License** — fully open source. Use it however you want. No restrictions, no commercial tier, no paywalls.

See [LICENSE](LICENSE) for the full text.

---

## Acknowledgments

CircuitMuse is built on the incredible work of the [Velxio](https://github.com/davidmonterocrespo24/velxio) project by [David Montero Crespo](https://github.com/davidmonterocrespo24). We are deeply grateful for:

- The multi-board emulation engine (AVR8, RP2040, ESP32, STM32, Raspberry Pi)
- The 100+ component system built on wokwi-elements
- The SPICE analog simulation integration
- The Monaco Editor integration and wire routing system
- The arduino-cli compilation backend

### Upstream Dependencies

- [Velxio](https://github.com/davidmonterocrespo24/velxio) — Original project
- [Wokwi](https://wokwi.com) — Inspiration for the component system
- [avr8js](https://github.com/wokwi/avr8js) — AVR8 emulator
- [wokwi-elements](https://github.com/wokwi/wokwi-elements) — Electronic web components
- [rp2040js](https://github.com/wokwi/rp2040js) — RP2040 emulator
- [ngspice-wasm](https://github.com/wokwi/ngspice-wasm) — SPICE simulation
- [lcgamboa/qemu](https://github.com/lcgamboa/qemu) — ESP32 Xtensa emulation
- [Tauri](https://tauri.app) — Desktop application framework
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — Code editor
