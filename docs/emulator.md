# Emulator Architecture

Velxio uses **real CPU emulation** on every supported board — never a simplified state machine. This document walks through each backend and how they share the same UI and bus abstractions.

There are **five distinct CPU backends**:

| Backend | CPU family | Boards | Where it runs |
|---------|-----------|--------|---------------|
| **avr8js** | AVR8 (ATmega328P, ATmega2560, ATtiny85) | Uno, Nano, Mega 2560, ATtiny85 | Browser (TypeScript) |
| **rp2040js** | ARM Cortex-M0+ | Pi Pico, Pi Pico W | Browser (TypeScript) |
| **QEMU lcgamboa (Xtensa)** | Xtensa LX6 / LX7 | ESP32 DevKit V1, DevKit C V4, ESP32-CAM, Wemos Lolin32 Lite, ESP32-S3, XIAO ESP32-S3, Arduino Nano ESP32 | Backend (`libqemu-xtensa.so/dll`) |
| **QEMU lcgamboa (RISC-V)** | RISC-V RV32IMC | ESP32-C3 DevKit, XIAO ESP32-C3, ESP32-C3 SuperMini | Backend (`libqemu-riscv32.so/dll`) |
| **QEMU upstream (ARM)** | ARM Cortex-A7/A53/A72/A76 | Raspberry Pi Zero / 1 / 2 / 3B / 4B / 5 | Backend (`qemu-system-arm` / `qemu-system-aarch64`) |

The browser backends (avr8js, rp2040js) execute in a Web Worker — no roundtrip to the server during simulation. The QEMU backends run as Python-managed subprocesses and stream events over WebSocket to the frontend.

---

## High-Level Data Flow

```text
User Code (Monaco Editor — multi-file)
        v
   useEditorStore (Zustand)
        v
  FastAPI backend  -->  arduino-cli / ESP-IDF / rp2040 toolchain  -->  .hex / .bin / .uf2
        v
  Per-board Simulator (browser) OR QEMU bridge (backend WebSocket)
        v
  CPU execution loop (~60 FPS via requestAnimationFrame, OR event-driven over WS)
        v
  GPIO / UART / I2C / SPI / RMT / PWM bus events
        v
  PinManager  -->  ngspice analog netlist (if enabled)
        v
  PartSimulationRegistry  -->  wokwi-element + Velxio Web Components update
```

The same `useSimulatorStore` + `PinManager` layer sits in front of every backend. Components don't know whether they're talking to avr8js, rp2040js, or QEMU — they just subscribe to `pin 13 went HIGH` events.

---

## AVR8 Emulation (Arduino Uno / Nano / Mega / ATtiny85)

Backed by **[avr8js](https://github.com/wokwi/avr8js)** running in the browser.

### Execution loop

Each animation frame executes approximately 267,000 CPU cycles (16 MHz / 60 FPS):

```typescript
avrInstruction(cpu);  // decode + execute one AVR instruction
cpu.tick();           // advance peripheral timers and counters
```

A speed multiplier (`0.1x` – `10x`) scales the cycles-per-frame budget.

### Supported peripherals

| Peripheral | Notes |
|-----------|-------|
| GPIO | PORTB (pins 8–13), PORTC (A0–A5), PORTD (pins 0–7) on Uno/Nano; all ports on Mega2560; PB0–PB5 on ATtiny85 |
| Timer0 / Timer1 / Timer2 | `millis()`, `delay()`, PWM via `analogWrite()` (registers polled each frame: OCR0A/B, OCR1AL/BL, OCR2A/B) |
| USART | Full transmit + receive, auto baud-rate detection from UBRR |
| ADC | 10-bit, 5 V ref on A0–A5 — voltage is **injected from the live SPICE node**, not from `setAnalog()` calls |
| SPI | Hardware SPI peripheral (ILI9341, SD card, NeoPixel single-color) |
| I2C (TWI) | Hardware I2C with virtual device bus (DS1307, TMP102, EEPROM, BMP280) |

### Pin mapping (Uno / Nano)

| Arduino Pin | AVR Port | Bit |
|-------------|----------|-----|
| 0–7 | PORTD | 0–7 |
| 8–13 | PORTB | 0–5 |
| A0–A5 | PORTC | 0–5 |

### ATtiny85 specifics

8 MHz internal / 16 MHz external (PLL), all 6 I/O pins, USI peripheral (used as `Wire` library backend), Timer0/Timer1, 10-bit ADC on PB2–PB5. Compiled with **AttinyCore** (`ATTinyCore:avr:attinyx5:chip=85,clock=16pll`).

---

## RP2040 Emulation (Raspberry Pi Pico / Pico W)

Backed by **[rp2040js](https://github.com/wokwi/rp2040js)** running in the browser.

| Feature | Details |
|---------|---------|
| Clock | 133 MHz, dual-core (we run core0 only for now) |
| GPIO | All 30 pins — input, output, event listeners, pin-state injection |
| UART | UART0 + UART1, Serial Monitor wires up to UART0 by default |
| ADC | 12-bit on GPIO 26–29 (A0–A3) + internal temperature sensor (ch4) |
| I2C | I2C0 + I2C1, master mode, virtual device bus |
| SPI | SPI0 + SPI1, configurable loopback or custom MISO injection |
| PWM | Any GPIO, full duty-cycle readout |
| Timing | WFI fast-forward — `delay()` advances simulation time instead of busy-waiting |
| Oscilloscope hook | GPIO transition timestamps at ~8 ns resolution (feeds the on-canvas oscilloscope) |

### Pico W extras

The Pico W ships a simulated **CYW43439** WiFi chip. See [Pico W WiFi Emulation](./PICO_W_WIFI_EMULATION.md) for the SPI handshake, RFC1483 framing, and SLIRP NAT bridge.

Compiled with the [earlephilhower arduino-pico](https://github.com/earlephilhower/arduino-pico) core. Serial redirect to UART0 is patched into `sketch.ino` only (other files left alone).

See [RP2040 Emulation](./RP2040_EMULATION.md) for the full peripheral model.

---

## Xtensa ESP32 / ESP32-S3 (QEMU)

Backed by the **[lcgamboa QEMU fork](https://github.com/lcgamboa/qemu)** running as a `libqemu-xtensa.{dll,so,dylib}` shared library, embedded by the FastAPI backend. The frontend talks to it over a WebSocket bridge (`/ws/sim/{board_id}`).

| Feature | Notes |
|---------|-------|
| Clock | LX6 @ 240 MHz (ESP32), LX7 @ 240 MHz (S3), dual-core models |
| GPIO | All 40 pins on classic ESP32; direction tracking, GPIO32–39 fix (input-only quirk handled), pin-state callbacks |
| UART | UART0, UART1, UART2 — multi-UART serial, auto baud-rate detection |
| ADC | 12-bit on every ADC-capable pin, 0–3300 mV injection from canvas potentiometers and from the live SPICE node |
| I2C | Synchronous bus + virtual device response |
| SPI | Full-duplex with configurable MISO byte injection |
| RMT / NeoPixel | Hardware RMT decoder, WS2812 24-bit GRB frame decoding |
| LEDC / PWM | 16 channels, duty-cycle readout, LEDC->GPIO mapping, LED brightness |
| WiFi | SLIRP NAT — connect with `WiFi.begin("PICSimLabWifi", "")` |
| BLE | Advertising + basic GAP via QEMU's BLE shim |

Toolchain pinned to **arduino-esp32 2.0.17 (IDF 4.4.x)** — only version compatible with the lcgamboa WiFi shim. ESP-IDF projects (`idf.py`) supported via the [espidf_compiler](../backend/app/services/espidf_compiler.py) wrapper.

See [ESP32 Emulation](./ESP32_EMULATION.md) for setup and architectural details, [ESP32 WiFi/Bluetooth](./ESP32_WIFI_BLUETOOTH.md) for the radio stack.

---

## RISC-V ESP32-C3 (QEMU)

Same QEMU backend pattern as Xtensa, different library (`libqemu-riscv32.{dll,so,dylib}`) and machine type (`esp32c3-picsimlab`).

| Feature | Notes |
|---------|-------|
| ISA | RV32IMC @ 160 MHz |
| GPIO | 0–21 via W1TS/W1TC MMIO registers |
| UART | UART0 to the Serial Monitor |
| ADC | 12-bit, ADC1 channels |
| WiFi / BLE | Same SLIRP path as Xtensa ESP32 |

A TypeScript ISA layer also lives at `frontend/src/simulation/RiscVCore.ts` + `Esp32C3Simulator.ts`. It exists for Vitest unit-test infrastructure — it does not implement the 150+ ROM functions ESP-IDF needs and is not the production emulation path. **All shipped ESP32-C3 simulation goes through QEMU.**

See [RISC-V Emulation](./RISCV_EMULATION.md) for details.

---

## ARM Raspberry Pi (QEMU)

The Pi family runs in **upstream QEMU** (no patches): `qemu-system-arm` for Pi Zero/1/2 and `qemu-system-aarch64` for Pi 3B / 4B / 5.

| Feature | Notes |
|---------|-------|
| CPU | Cortex-A7 (Zero/1/2), A53 (3B), A72 (4), A76 (5) |
| Machine | `virt` for armhf, `raspi3b` for Pi 3B (full BCM2837), `virt` again for 4/5 |
| OS | Raspberry Pi OS (Trixie) — real Linux userland, runs Python 3 scripts directly |
| GPIO | 0–27 — output, input, event detection, PWM (binary state). Driven by an in-image **RPi.GPIO shim** that streams events over `ttyAMA1` |
| Serial | `ttyAMA0` for the user-facing Serial Monitor, `ttyAMA1` for the GPIO protocol |
| Storage | qcow2 overlay on top of the base SD image — base never mutates, session state is isolated |
| File system | UI-side **Virtual File System** (`useVfsStore`) — edit Python on the canvas, upload to the Pi at boot |
| Multi-board | UART bridge to AVR / RP2040 / ESP32 instances on the same canvas |

Boot kernels (`kernel8.img`), device trees (`bcm2710-rpi-3-b.dtb`), and base OS images live in `img/` and are bundled into the Docker image. To rebuild from scratch, see [BUILD-QEMU.md](./BUILD-QEMU.md) and [BOOT_IMAGES.md](./BOOT_IMAGES.md).

See [Raspberry Pi 3 Emulation](./RASPBERRYPI3_EMULATION.md) for the full bridge protocol.

---

## Languages

| Language | Boards | Toolchain |
|----------|--------|-----------|
| Arduino C++ | Every board | `arduino-cli` (AVR / RP2040 / ATtiny / ESP32) |
| ESP-IDF C | All ESP32 variants | `idf.py` (via [espidf_compiler.py](../backend/app/services/espidf_compiler.py)) |
| MicroPython | Pico, Pico W, all ESP32 / ESP32-S3 / ESP32-C3 | Pre-built MicroPython firmware booted under QEMU; user `.py` files mounted via VFS |
| Python 3 | All Raspberry Pi boards | Native — runs on the booted Pi OS rootfs with the `RPi.GPIO` shim pre-installed |

The `languageMode` field on each `BoardInstance` toggles between `arduino` and `micropython`. See [MicroPython Implementation](./MICROPYTHON_IMPLEMENTATION.md) for how `.py` files reach the running firmware on Pico and ESP32.

---

## Multi-board canvases

Multiple boards can sit on the same canvas, each with its own file group, its own running state, and its own Serial Monitor:

- A potentiometer wired to A0 of board A and A1 of board B is the **same** SPICE node — both ADCs read the same voltage.
- UART TX of board A wired to UART RX of board B forwards bytes through the backend message bus.
- Each board's pin state changes feed the same `PinManager`, so a NeoPixel ring wired to two boards reflects whichever wrote last.

Board instance IDs are deterministic — the first board of a kind uses the bare `boardKind` string (e.g. `arduino-uno`) as its ID; subsequent ones get a suffix. Example payloads in `frontend/src/data/examples.ts` (`boards: [...]` field) demonstrate the multi-board format.

---

## HEX / BIN / UF2 loading

- **AVR / RP2040** — Intel HEX produced by `arduino-cli`. Parser in `frontend/src/utils/hexParser.ts` reads `:`-prefixed lines, extracts addresses, returns a `Uint8Array`. AVRSimulator widens it to `Uint16Array` (16-bit words, little-endian).
- **ESP32 family** — ESP-IDF `.bin` files (bootloader + partition table + app). The backend writes them straight into the QEMU image at boot.
- **Pi family** — no firmware artifact; the user's Python files are uploaded to the running OS via the VFS at boot.

---

## Co-simulation with ngspice

When the **Electrical Sim** toggle is on, the simulator builds a SPICE netlist every frame:

1. **`NetlistBuilder`** (`frontend/src/simulation/spice/NetlistBuilder.ts`) runs Union-Find on `wires[]` to coalesce connected pins into electrical nodes.
2. Each component's `componentToSpice.ts` mapper emits SPICE cards (R, C, L, D, Q, M, V, I, op-amp subcircuits, …).
3. Each MCU digital output pin becomes a Thevenin source — voltage from the port driver, output impedance from the port driver model.
4. `useElectricalStore` calls into the lazy-loaded ngspice WASM (`SpiceEngine.lazy.ts`) and asks for a `.op` transient point.
5. Node voltages flow back: each MCU ADC reads its node's voltage on the next `analogRead()`, instruments (voltmeter, ammeter, oscilloscope) read their probe nodes directly.

See [Electrical Simulation User Guide](./wiki/electrical-simulation-user-guide.md) for the user-facing workflow and the [Circuit Emulation series](./wiki/circuit-emulation-overview.md) for engine internals.

---

## Component System

Components are Web Components — either upstream [wokwi-elements](https://github.com/wokwi/wokwi-elements) (Lit) or Velxio-native (vanilla `HTMLElement` + Shadow DOM).

### Registration

1. The component is rendered on `SimulatorCanvas` via `<DynamicComponent>`, which calls `document.createElement(metadata.tagName)`.
2. `DynamicComponent` extracts the `pinInfo` getter from the rendered DOM (100ms polling, 2s timeout).
3. If the component is in `PartSimulationRegistry`, its handlers are attached:
   - **Output components** — `onPinStateChange(pinName, state, element)` updates the element's properties when the bus says the pin changed.
   - **Input components** — `attachEvents(element, simulator, pinHelper)` registers DOM event listeners that inject pin state into the CPU.
4. Arduino pin assignment is resolved from connected wires (or from the property dialog when not wired).

### Wire routing

Wires use **orthogonal routing** (no diagonal paths). Each wire stores:

```typescript
{
  id: string
  start: { componentId, pinName, x, y }
  end:   { componentId, pinName, x, y }
  color: string         // e.g. 'red' for VCC
  signalType: 'digital' | 'analog' | 'power-vcc' | 'power-gnd' | 'pwm' | 'i2c' | 'spi' | 'usart'
}
```

Wire positions update automatically when components move (`updateWirePositions(componentId)` after drag, with retries at 100/300/500 ms for board-internal pins that mount asynchronously).

---

## Key Source Files

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/simulation/AVRSimulator.ts` | AVR8 CPU emulator wrapper |
| `frontend/src/simulation/RP2040Simulator.ts` | RP2040 wrapper, WFI fast-forward |
| `frontend/src/simulation/Esp32Bridge.ts` | WebSocket bridge to the Xtensa/RISC-V QEMU worker |
| `frontend/src/simulation/RaspberryPi3Bridge.ts` | UART + GPIO bridge to the QEMU Pi instance |
| `frontend/src/simulation/RiscVCore.ts` | RV32IMC TypeScript ISA (test-only) |
| `frontend/src/simulation/PinManager.ts` | Pin-to-component mapping, listener dispatch |
| `frontend/src/simulation/PartSimulationRegistry.ts` | Per-component output/input handlers |
| `frontend/src/simulation/spice/` | ngspice WASM, NetlistBuilder, MNA solver, component mappers |
| `frontend/src/utils/hexParser.ts` | Intel HEX parser |
| `frontend/src/utils/pinPositionCalculator.ts` | Pin coordinate conversion (element -> canvas) |

### Backend

| File | Purpose |
|------|---------|
| `backend/app/services/arduino_cli.py` | arduino-cli subprocess wrapper |
| `backend/app/services/espidf_compiler.py` | ESP-IDF subprocess wrapper |
| `backend/app/services/qemu_manager.py` | QEMU process lifecycle (Pi family) |
| `backend/app/services/esp32_worker.py` | libqemu-xtensa / libqemu-riscv32 process supervisor |
| `backend/app/services/gpio_shim.py` | RPi.GPIO -> WebSocket bridge for Pi family |
| `backend/app/api/routes/compile.py` | `/api/compile/` — Arduino compile (sync + async) |
| `backend/app/api/routes/compile_chip.py` | `/api/compile/chip/` — Custom-chip WASM compile |
| `backend/app/api/routes/simulation.py` | `/ws/sim/{board_id}` — QEMU WebSocket bridge |
| `backend/app/api/routes/iot_gateway.py` | HTTP proxy for ESP32 web servers (real browser <-> simulated ESP32) |
