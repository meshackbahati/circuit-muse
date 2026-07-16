# CircuitMuse

AI-powered circuit simulator and embedded board emulator for desktop. Write Arduino C++ or MicroPython, compile it, simulate it with real CPU emulation and 100+ interactive electronic components — and chat with an AI to design circuits, debug code, and wire components.

**31 boards · 6 CPU architectures**: AVR8 (ATmega/ATtiny), ARM Cortex-M0+ (RP2040), Xtensa LX6/LX7 (ESP32), RISC-V RV32IMC (ESP32-C3), ARM Cortex-M (STM32), ARM Cortex-A (Raspberry Pi 3/4/5).

---

## Features

### AI Agent

- **Natural language circuit design** — "Add an Arduino Uno and wire an LED to pin 13"
- **Multi-provider support** — OpenAI, Anthropic, Ollama (local), Google Gemini, OpenRouter, Moonshot, custom endpoints
- **Tool calling** — the AI can directly place components, wire circuits, write code, and run simulations
- **Bring Your Own Key** — your API keys stay on your machine, never sent anywhere

### Code Editing

- **Monaco Editor** — C++ / Python with syntax highlighting, autocomplete, dark theme
- **Multi-file workspace** — `.ino`, `.h`, `.cpp`, `.py` files per board
- **Arduino compilation** via `arduino-cli`
- **ESP-IDF compilation** via `idf.py` with ccache

### Multi-Board Simulation

| Board | CPU | Engine |
| ----- | --- | ------ |
| Arduino Uno / Nano / Mega | ATmega328p / ATmega2560 | avr8js |
| ATtiny85 | ATtiny85 | avr8js |
| Raspberry Pi Pico / Pico W | RP2040 | rp2040js |
| ESP32 DevKit / CAM / Lolin32 | Xtensa LX6 | QEMU |
| ESP32-S3 / XIAO ESP32-S3 | Xtensa LX7 | QEMU |
| ESP32-C3 / SuperMini | RISC-V RV32IMC | QEMU |
| STM32 Blue Pill / Nucleo | ARM Cortex-M3 | QEMU |
| Raspberry Pi 3B / 4B / 5 | ARM Cortex-A | QEMU + Linux |

### Component System (150+ Components)

LEDs, resistors, capacitors, transistors, op-amps, logic gates, servos, motors, sensors (DHT22, HC-SR04, BMP280, MPU6050), displays (OLED, LCD, TFT, E-Paper), NeoPixels, relays, potentiometers, pushbuttons, switches, buzzers, and more.

### Electrical Simulation

- **ngspice-WASM** — real SPICE analog simulation
- **Mixed-mode** — digital MCU + analog circuits together
- **Instruments** — voltmeter, ammeter, oscilloscope, function generator

### Project Persistence & Import/Export

- **Auto-save** — projects persist in IndexedDB across sessions
- **Import formats**: `.vlx`, `.zip` (Wokwi), `.fzz` (Fritzing), `.json`
- **Export formats**: `.vlx`, `.zip` (Wokwi-compatible), `.json`, `.html` report

### Serial Monitor

- Live serial output with auto baud-rate detection
- Send data to RX pin from the UI

---

## Desktop App

Native desktop application via Tauri — Windows, macOS, Linux.

### Install

Download from [Releases](https://github.com/meshackbahati/circuit-muse/releases):
- **Windows** — `.msi` installer
- **macOS** — `.dmg` disk image
- **Linux** — `.deb`, `.AppImage`, `.rpm`

### Development

```bash
git clone https://github.com/meshackbahati/circuit-muse.git
cd circuit-muse

# Install dependencies
cd app && npm install && cd ..
cd engine && pip install -r requirements.txt && cd ..

# Run development
cd app && npm run dev    # Frontend on :5173
cd engine && uvicorn app.main:app --port 8001  # Backend on :8001

# Or run desktop
cd src-tauri && cargo tauri dev
```

---

## AI Agent Setup

Configure in the chat panel settings:

| Provider | Setup |
|----------|-------|
| **Ollama** (local) | Install [Ollama](https://ollama.com), run `ollama pull llama3` — no API key needed |
| **OpenAI** | Paste API key from [platform.openai.com](https://platform.openai.com) |
| **Anthropic** | Paste API key from [console.anthropic.com](https://console.anthropic.com) |
| **Google Gemini** | Paste API key from [aistudio.google.com](https://aistudio.google.com) |
| **OpenRouter** | Paste API key from [openrouter.ai](https://openrouter.ai) |
| **Custom** | Any OpenAI-compatible endpoint (LM Studio, vLLM, etc.) |

---

## Project Structure

```text
circuit-muse/
├── app/                     # Application layer (React + Vite + TypeScript)
│   ├── src/agent/           # AI agent (providers, tools, chat UI)
│   ├── src/components/      # Editor, simulator canvas, modals
│   ├── src/simulation/      # CPU emulation bridges
│   ├── src/store/           # Zustand state stores
│   ├── src/services/        # API clients, project persistence
│   └── src/desktop/         # Tauri desktop integration
├── engine/                  # Simulation engine (FastAPI + Python)
│   └── app/api/routes/      # compile, agent, libraries, simulation
├── src-tauri/               # Desktop shell (Rust + Tauri)
└── docs/                    # Technical documentation
```

---

## License

MIT License — fully open source. No restrictions, no commercial tier.

---

## Acknowledgments

Based on [Velxio](https://github.com/davidmonterocrespo24/velxio) by David Montero Crespo. Built on [avr8js](https://github.com/wokwi/avr8js), [rp2040js](https://github.com/wokwi/rp2040js), [wokwi-elements](https://github.com/wokwi/wokwi-elements), [ngspice-wasm](https://github.com/wokwi/ngspice-wasm), [lcgamboa/qemu](https://github.com/lcgamboa/qemu), [Tauri](https://tauri.app), and [Monaco Editor](https://microsoft.github.io/monaco-editor/).
