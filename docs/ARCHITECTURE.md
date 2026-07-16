# Project Architecture — Velxio

## Overview

Velxio is a **fully local, multi-board emulator and electronics simulator** that runs in the browser and on the desktop. Five CPU backends, one analog (ngspice-WASM) engine, 150+ catalog components, a custom-chip SDK, and a Tauri desktop shell — all tied together by a Zustand state core and a thin FastAPI compile + bridge backend.

```text
+---------------------------------------------------------------------+
|                          USER (Browser or Tauri)                    |
|       Web: http://localhost:3080 (Docker) or velxio.dev             |
|       Desktop: velxio-desktop (Tauri shell)                         |
+--------------------------------+------------------------------------+
                                 |
                                 v
+---------------------------------------------------------------------+
|                FRONTEND (React 19 + Vite 7 + TypeScript)            |
|                                                                     |
|  +-----------------+  +------------------+  +-------------------+   |
|  | Monaco Editor   |  |  Zustand Stores  |  |  SimulatorCanvas  |   |
|  | Multi-file C++  |  |  Editor + Sim    |  |  Components+Wires |   |
|  | / .py / .chip.c |  |  Electrical+VFS  |  |  Pin overlay      |   |
|  +--------+--------+  +--------+---------+  +---------+---------+   |
|           |                    |                      |             |
|           v                    v                      v             |
|  +---------------------------------------------------------------+  |
|  | 5 CPU backends, one PinManager facade                         |  |
|  |  - AVRSimulator (avr8js, browser)                             |  |
|  |  - RP2040Simulator (rp2040js, browser, WFI fast-forward)      |  |
|  |  - Esp32Bridge (WebSocket -> QEMU Xtensa/RISC-V worker)       |  |
|  |  - RaspberryPi3Bridge (WebSocket -> QEMU raspi3b)             |  |
|  |  - RiscVCore (TypeScript ISA, Vitest only)                    |  |
|  +-------------------------------+-------------------------------+  |
|                                  v                                  |
|  +---------------------------------------------------------------+  |
|  | PinManager + PartSimulationRegistry                           |  |
|  | Digital/PWM/Analog listeners, 16+ registered output parts,    |  |
|  | event-driven input parts (buttons, switches, encoders, ...)   |  |
|  +---------------------------------------------------------------+  |
|                                  v                                  |
|  +---------------------------------------------------------------+  |
|  | Electrical engine (lazy, ~39 MB ngspice WASM bundle)          |  |
|  | NetlistBuilder (Union-Find on wires) -> SPICE cards           |  |
|  | useElectricalStore + analog instruments (V/A/scope/funcgen)   |  |
|  +---------------------------------------------------------------+  |
|                                  v                                  |
|  +---------------------------------------------------------------+  |
|  | Component Layer                                                |  |
|  | wokwi-elements (Lit) + Velxio-native Web Components            |  |
|  | DynamicComponent renderer, ComponentRegistry (metadata.json)   |  |
|  | ComponentPickerModal, property dialog, pin selector            |  |
|  +---------------------------------------------------------------+  |
|                                                                     |
|  +---------------------------------------------------------------+  |
|  | Wire System                                                    |  |
|  | Orthogonal routing, segment edit, 8 signal colors,             |  |
|  | overlap offset, pin overlay, 20px grid snap                    |  |
|  +---------------------------------------------------------------+  |
|                                                                     |
|  Custom Chips runtime                                               |
|  WASI shim, SPI/I2C bus bridges, ChipRuntime per instance           |
+--------------------------------+------------------------------------+
                                 | HTTP (Axios) + WebSocket
                                 v
+---------------------------------------------------------------------+
|                  BACKEND (FastAPI + Python 3.12)                    |
|                     http://localhost:8001                           |
|                                                                     |
|  +-------------------------------------------------------------+    |
|  | /api/compile/      sync + async Arduino / RP2040 compile    |    |
|  | /api/compile/chip/ Custom-chip WASM compile                 |    |
|  | /api/libraries/    arduino-cli library search + install     |    |
|  | /ws/sim/{id}       QEMU bridge (Xtensa, RISC-V, ARM Pi)     |    |
|  | /api/iot/          HTTP proxy to simulated ESP32 servers    |    |
|  | /api/mcp/, /sse/   MCP server (stdio + SSE)                 |    |
|  +-------------------------------+----------------------------+    |
|                                  v                                 |
|  +-------------------------------------------------------------+    |
|  | Services                                                    |    |
|  | arduino_cli  espidf_compiler  qemu_manager  esp32_worker    |    |
|  | wasm_chip_runtime  gpio_shim                                |    |
|  +-------------------------------+----------------------------+    |
+--------------------------------+------------------------------------+
                                 v
       arduino-cli       ESP-IDF       libqemu-xtensa.so
       (subprocess)      (subprocess)  libqemu-riscv32.so
                                       qemu-system-aarch64 (Pi)
```

The backend is **stateless** by design — no database, no auth, no per-user files. Compilation results are returned over HTTP and discarded; QEMU instances live only as long as the WebSocket session.

> **Production overlay (velxio-prod):** accounts, public profiles, persistent project URLs, the admin panel, analytics, and Pro features (custom-chip cloud build, premium components, AI assistant) live in a private repo and are layered onto the Docker image at deploy time. The OSS image you build from this repo is the same shell minus those routes. See [README.md](../README.md) §License.

---

## Data flow

### 1. Code editing

```text
User writes code
   v
Monaco Editor (.ino / .cpp / .h / .py / .chip.c)
   v
useEditorStore.files[]  (per-board multi-file workspace)
   v
Active file -> editor; file group switches on board selection
```

`useEditorStore` holds:

```typescript
interface WorkspaceFile { id: string; name: string; content: string; modified: boolean; }
files: WorkspaceFile[]
activeFileId: string
openFileIds: string[]
fileGroups: Record<string, string[]>   // boardInstanceId -> file IDs
```

Operations: `createFile`, `deleteFile`, `renameFile`, `setFileContent`, `markFileSaved`, `openFile`, `closeFile`, `setActiveFile`, `loadFiles` (for `.vlx` import).

### 2. Compilation

```text
Click "Compile"
   v
EditorToolbar -> compileCode({ files, board_fqbn })
   v
Axios POST -> http://localhost:8001/api/compile/
   v
Backend dispatch (by FQBN prefix):
   arduino:avr:*    -> ArduinoCLIService.compile()
   rp2040:rp2040:*  -> same + earlephilhower core
   esp32:esp32:*    -> ESP-IDF compile (full project, ccache + persistent build dir)
   v
First .ino promoted to sketch.ino (RP2040 Serial redirect applied to sketch.ino only)
   v
Returns hex_content / bin_payload + compile log
   v
useSimulatorStore.setCompiledProgram(boardId, payload)  -> auto-loadHex/loadBin
```

### 3. Simulation

#### Browser backends (AVR, RP2040)

```text
Click "Run"
   v
useSimulatorStore.startSimulation(boardId)
   v
Per-board simulator instance.start()
   v
requestAnimationFrame loop @ ~60 FPS
   v
Each frame: Math.floor(cyclesPerSecond / 60 * speed) cycles
   v
For each cycle: instruction() + cpu.tick()
   v
Port writes -> AVRIOPort / RP2040 IOReg listeners
   v
PinManager.updatePort(portName, newValue, oldValue)
   v
Per-pin callbacks fire -> PartSimulationRegistry.onPinStateChange()
   v
Web Component property updates (LED color, LCD frame buffer, NeoPixel grid, ...)
```

#### QEMU backends (ESP32, ESP32-C3, Pi family)

```text
Click "Run"
   v
useSimulatorStore.startSimulation(boardId)
   v
WebSocket connect -> /ws/sim/{boardId}
   v
Backend spawns QEMU process (or attaches libqemu lib)
   v
QEMU loads firmware/OS image (qcow2 overlay for Pi)
   v
QEMU emits GPIO/UART/I2C/SPI events -> backend serializes -> WebSocket
   v
Frontend bridge dispatches into PinManager (same as browser backends)
```

### 4. Input components

```text
User presses pushbutton on canvas
   v
Web component fires 'button-press' event
   v
DynamicComponent forwards to PartSimulationRegistry.attachEvents handler
   v
Simulator.setPinState(arduinoPin, LOW)
   v
For browser backends: AVRIOPort.setPin(bitIndex) injects external state
For QEMU backends:   pin-state command goes over WebSocket to QEMU
```

### 5. Wire creation

```text
Click pin on component A   -> startWireCreation(endpoint)
   v
Mouse move                 -> updateWireInProgress(x, y)
   v
WireInProgressRenderer shows dashed green L-shape preview
   v
Click pin on component B   -> finishWireCreation(endpoint)
   v
Wire object stored in useSimulatorStore.wires[]
   v
WireLayer renders SVG orthogonal path (with overlap offset)
   v
Components subscribe to Arduino pin via wire lookup (DynamicComponent)
```

### 6. Electrical co-simulation (when toggled on)

```text
Each frame (debounced):
   v
NetlistBuilder runs Union-Find on wires[] -> electrical nodes
   v
For each component, componentToSpice() emits SPICE cards
   v
MCU digital pins -> Thevenin sources (V = port driver, R_out = driver model)
   v
Lazy-loaded ngspice WASM (.op transient) computes node voltages
   v
Voltmeter / ammeter / oscilloscope read probes
ADCs read their node voltage on the next analogRead()
```

---

## State stores

| Store | File | Purpose |
|-------|------|---------|
| `useEditorStore` | `frontend/src/store/useEditorStore.ts` | Multi-file workspace, file groups per board |
| `useSimulatorStore` | `frontend/src/store/useSimulatorStore.ts` | Boards, components, wires, simulators, running state |
| `useProjectStore` | `frontend/src/store/useProjectStore.ts` | Current loaded project metadata (id, slug, name) for `.vlx` export |
| `useElectricalStore` | `frontend/src/store/useElectricalStore.ts` | SPICE engine state, node voltages, probe readings |
| `useVfsStore` | `frontend/src/store/useVfsStore.ts` | Virtual File System for Pi family (Python files mounted at boot) |
| `useAuthStore` (overlay) | `pro/frontend/src/pro/store/useAuthStore.ts` | Lives only in velxio-prod overlay — OSS has no auth |

---

## Component plugin system

`PartSimulationRegistry` decouples simulation logic from rendering. A part registers two optional hooks:

```typescript
interface PartSimulation {
  onPinStateChange?(pinName: string, state: PinState, element: HTMLElement): void;
  attachEvents?(element: HTMLElement, simulator: Simulator, pinHelper: PinHelper): () => void;
}
```

**Registered parts (16+):**

| Part | Type | Key behavior |
|------|------|--------------|
| `led`, `wokwi-led` | Output | Pin -> `element.value` |
| `rgb-led` | Output | Digital + PWM on R/G/B -> `ledRed/Green/Blue` |
| `led-bar-graph` | Output | 10 LEDs (A1–A10) -> `.values` array |
| `7segment` | Output | 8 segments (A–G + DP) -> `.values` array |
| `pushbutton`, `pushbutton-6mm` | Input | Press/release -> `setPinState(pin, LOW/HIGH)` |
| `slide-switch` | Input | Change event -> pin state |
| `dip-switch-8` | Input | 8 independent switches |
| `potentiometer`, `slide-potentiometer` | Input | Value (0–1023) -> ADC voltage injection; also a SPICE resistor in analog mode |
| `analog-joystick` | Input | VRX/VRY (ADC) + SW (digital) |
| `servo` | Output | Polls OCR1A/ICR1 -> angle 0–180° |
| `buzzer` | Output | Web Audio API, reads Timer2 registers |
| `lcd1602`, `lcd2004` | Output | Full HD44780 4-bit protocol |
| `neopixel-*` | Output | RMT-decoded 24-bit GRB frame -> per-LED color |
| `epaper-*` | Output | Waveshare driver, full-buffer refresh |
| `oscilloscope`, `voltmeter`, `ammeter`, `function-gen` | Velxio-native | Read/write the ngspice node graph |

Adding a new behavior: write the handler, register it in `PartSimulationRegistry`, ship. No edits to `SimulatorCanvas` needed.

---

## Custom chips runtime

User-defined chips compile from C to WebAssembly via `backend/app/api/routes/compile_chip.py` and run inside `frontend/src/simulation/customChips/ChipRuntime.ts`. The runtime exposes:

- **Digital GPIO** — pin watch, edge detection
- **Analog out (DAC)** — sets a node voltage that ngspice picks up
- **I2C slave, SPI slave, UART** — bus bridges that look like real peripherals to the MCU side
- **Timers, framebuffer, log** — utility hooks
- **WASI shim** — minimal subset for printf/clock

30+ example chips ship in `frontend/src/components/customChips/examples/` (Intel 4004, 8080, 8086, Z80, 74HC595, 24LC256, MCP3008, PCF8574, DS3231, …). See [CUSTOM_CHIPS.md](./CUSTOM_CHIPS.md) and [Custom Chips ESP32 Runtime](./wiki/custom-chips-esp32-backend-runtime.md).

---

## Persistence

OSS Velxio has **no server-side state**. Projects are saved as `.vlx` files — a single JSON snapshot of:

- All boards (kind, position, board options, file groups)
- All components (type, position, properties, rotation)
- All wires (endpoints, color, signal type)
- Code for every file group
- VFS contents (Pi Python files)
- Electrical-sim toggle state, instrument configurations

`frontend/src/utils/vlxFile.ts` handles export and import. The format is versioned for forward compatibility.

The Save button is registered through `frontend/src/lib/proSaveAction.ts` — OSS default is "download `.vlx`"; the velxio-prod overlay replaces it with a "Save to your account" modal.

---

## Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `LandingPage` | Marketing landing page |
| `/editor` | `EditorPage` | Main multi-board editor + canvas |
| `/circuit` | `CircuitSimulatorPage` | Pure analog mode (no MCU) |
| `/electronics` | `ElectronicsSimulatorPage` | Alt analog entry point |
| `/arduino`, `/arduino-mega`, `/attiny85` | Board-specific simulator pages | Direct deep-link entry |
| `/esp32`, `/esp32-c3`, `/esp32-s3` | Board-specific ESP32 pages | Same |
| `/raspberry-pi-3` | Pi 3 simulator page | Same |
| `/custom-chip` | `CustomChipSimulatorPage` | Custom-chip editor + sandbox |
| `/examples` | `ExamplesPage` | Filterable gallery (380+ projects) |
| `/examples/:id` | `ExampleDetailPage` | Single example with run-now |
| `/docs` | `DocsPage` | In-app docs reader |

The pro overlay injects `/account`, `/login`, `/:username`, `/project/:slug`, and `/admin` routes at runtime via `frontend/src/lib/proRoutes.ts`.

---

## Apps and integrations

| Surface | Status | Doc |
|---------|--------|-----|
| **Web (OSS + Pro)** | Stable, deployed at velxio.dev | This repo |
| **Desktop (Tauri)** | Pro — 30-day trial, license-gated | [desktop-app.md](./desktop-app.md) |
| **MCP server** | OSS — stdio + SSE entry points | [MCP.md](./MCP.md) |
| **IoT gateway** | OSS — HTTP proxy real browser <-> simulated ESP32 web server | `backend/app/api/routes/iot_gateway.py` |

---

## Technology Stack

### Frontend

| Layer | Tech |
|-------|------|
| Framework | React 19, Vite 7, TypeScript 5.9 |
| Editor | Monaco Editor |
| State | Zustand 5 |
| Routing | React Router 7 |
| Networking | Axios + native WebSocket |
| UI components | wokwi-elements (Lit) + Velxio-native Web Components |
| AVR sim | avr8js (npm) |
| RP2040 sim | rp2040js (npm) |
| ESP32 sim | WebSocket bridge to backend QEMU worker |
| Pi sim | WebSocket bridge to backend QEMU process |
| Electrical sim | eecircuit-engine (ngspice-WASM), lazy-loaded |
| Custom-chip runtime | WASI shim + ChipRuntime in-browser |

### Backend

| Layer | Tech |
|-------|------|
| Framework | FastAPI |
| Runtime | Python 3.12, uvicorn |
| Compile | `arduino-cli` (subprocess), ESP-IDF (subprocess), Emscripten (custom chips) |
| QEMU | lcgamboa fork (libqemu-xtensa.so, libqemu-riscv32.so) + upstream QEMU 8.1.3 (qemu-system-aarch64 for Pi) |
| Bridge | WebSockets (per-board) |
| MCP | `backend/mcp_server.py` (stdio), `backend/mcp_sse_server.py` (SSE) |

### Deploy

- **Docker** — `Dockerfile.standalone` builds a multi-stage image. Published to GHCR + Docker Hub by GitHub Actions on push to `master`.
- **Manual** — frontend + backend independently. ESP32 / Pi need QEMU `.so` libs.
- **velxio.dev** — Pro overlay layered on the base image. Lives in [velxio/velxio-prod](https://github.com/velxio/velxio-prod) (private).

---

## Architecture Advantages

- **Real emulation everywhere.** No board has a hand-rolled state machine — every backend executes the real ISA.
- **Co-simulated digital + analog.** ngspice runs in the same loop as the MCU. ADC reads return real solved voltages, not lookup-table approximations.
- **Plugin-based component behaviors.** New parts register a handler; no `SimulatorCanvas` edits.
- **Build-time component discovery.** TypeScript AST parser extracts metadata from wokwi-elements source. Override file for Velxio-native parts.
- **Stateless backend.** Compile is HTTP; QEMU is per-WebSocket. No DB, no migrations, no user state in OSS.
- **Open-core split.** OSS is fully self-hostable, anonymous, single-user. Pro features layer in via overlay without touching the OSS code path.
- **Portable projects.** `.vlx` files round-trip every detail of a canvas. No server needed to share work.

---

## Planned

- More boards (STM32, RP2350, AVR-DA family)
- Wire validation (short detection, missing-GND warnings)
- Undo/redo for canvas operations
- Streaming compile (incremental ESP-IDF builds)
- WebGPU acceleration for the canvas at >200 components

See [roadmap.md](./roadmap.md) for the full list.

---

## References

- [README](../README.md)
- [Emulator Architecture](./emulator.md)
- [Components Reference](./components.md)
- [Custom Chips Guide](./CUSTOM_CHIPS.md)
- [Electrical Simulation User Guide](./wiki/electrical-simulation-user-guide.md)
- [MCP Server](./MCP.md)
- [Desktop App](./desktop-app.md)
- Upstream: [wokwi-elements](https://github.com/wokwi/wokwi-elements), [avr8js](https://github.com/wokwi/avr8js), [rp2040js](https://github.com/wokwi/rp2040js), [lcgamboa/qemu](https://github.com/lcgamboa/qemu)
