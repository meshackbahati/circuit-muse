# CircuitMuse — Simulator Interface

React + TypeScript + Vite frontend for the circuit simulator.

## Features

- **Monaco Code Editor** — C++ / Python with syntax highlighting, autocomplete
- **150+ Components** — LEDs, resistors, sensors, displays, logic gates, motors
- **Visual Simulator Canvas** — drag-and-drop circuit builder with wire routing
- **Multi-Board Support** — Arduino, ESP32, RP2040, STM32, Raspberry Pi
- **SPICE Simulation** — ngspice-WASM for analog circuit analysis
- **AI Agent** — chat interface with multi-provider LLM support

## Development

```bash
npm install
npm run dev
```

App available at http://localhost:5173 (requires backend at :8001)

## Project Structure

```
src/
├── agent/              # AI agent (providers, tools, chat UI)
├── components/         # Editor, simulator canvas, modals
├── desktop/            # Tauri desktop integration
├── simulation/         # CPU emulation bridges
├── store/              # Zustand state stores
├── services/           # API clients, project persistence
├── types/              # TypeScript definitions
└── utils/              # Helpers (export, import, wire routing)
```
