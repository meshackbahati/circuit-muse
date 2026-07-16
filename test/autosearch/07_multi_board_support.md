# Multi-board support — Custom Chips

> Validado el 2026-04-28. Fuente: `test/test_custom_chips_boards/` (24 tests pytest:
> compile + sketch + GPIO bridge + I2C + UART + SPI E2E),
> `test/test_chip_backend_runtime/` (11 tests pytest: runtime aislado),
> `test/test_custom_chips/` (70 tests vitest sandbox).

## Resumen ejecutivo

| Capa | Estado |
|---|---|
| Compilación de chips (`/api/compile-chip`) | ✅ funciona — 11/11 chips de la galería pasan |
| Compilación de sketches (`/api/compile`) | ✅ funciona en AVR (Uno/Nano/Mega), RP2040 Pi Pico, ESP32 |
| Runtime AVR (avr8js, browser) | ✅ GPIO+I2C+SPI+UART (sandbox 70/70) |
| Runtime ESP32 QEMU (lcgamboa, backend WASM-in-process) | ✅ GPIO + I2C + UART + SPI + pin_watch + timers (E2E con sketches reales) |
| Runtime RP2040 (rp2040js, browser) | ✅ GPIO + I2C + SPI + USART expuestos |
| Runtime ESP32-C3 (RV32IMC, browser) | ⚠️ Solo GPIO — peripherals stub |
| Runtime Raspberry Pi 3 (QEMU, backend) | ⚠️ Solo GPIO + Serial via WS |
| Runtime ATtiny85 (avr8js, browser) | ⚠️ Solo GPIO — chip no tiene TWI/SPI/USART |

## Matriz detallada

| Board kind | Simulator class | pinManager | i2cBus | spi | usart | Custom chip funciona |
|---|---|:---:|:---:|:---:|:---:|---|
| `arduino-uno` | `AVRSimulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `arduino-nano` | `AVRSimulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `arduino-mega` | `AVRSimulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `attiny85` | `AVRSimulator` | ✅ | ❌ | ❌ | ❌ | Solo GPIO |
| `raspberry-pi-pico` | `RP2040Simulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `pi-pico-w` | `RP2040Simulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `nano-rp2040` | `RP2040Simulator` | ✅ | ✅ | ✅ | ✅ | **GPIO + I2C + SPI + UART** |
| `esp32` y variants | `Esp32Bridge` (QEMU) | ✅ vía shim | **✅ backend WASM** | **✅ backend WASM** | **✅ backend WASM (UART0)** | **GPIO + I2C + SPI + UART + pin_watch + timers** |
| `esp32-s3` | `Esp32Bridge` | ✅ vía shim | **✅ backend WASM** | **✅ backend WASM** | **✅ backend WASM** | **GPIO + I2C + SPI + UART** |
| `esp32-cam` | `Esp32Bridge` | ✅ vía shim | **✅ backend WASM** | **✅ backend WASM** | **✅ backend WASM** | **GPIO + I2C + SPI + UART** |
| `esp32-c3` | `Esp32C3Simulator` | ✅ | ❌ | ❌ | ❌ | Solo GPIO |
| `xiao-esp32-c3` | `Esp32C3Simulator` | ✅ | ❌ | ❌ | ❌ | Solo GPIO |
| `arduino-nano-esp32` | `Esp32Bridge` | ✅ vía shim | **✅ backend WASM** | **✅ backend WASM** | **✅ backend WASM** | **GPIO + I2C + SPI + UART** |
| `raspberry-pi-3` | `RaspberryPi3Bridge` (QEMU) | ✅ vía shim | ❌ | ❌ | ❌ | GPIO + Serial vía WS |

## Componentes de display soportados

| Componente | AVR | RP2040 | ESP32 | Path |
|---|:---:|:---:|:---:|---|
| `wokwi-ssd1306` (I2C OLED) | ✅ | ✅ | ⚠️ I2C sink only (no canvas) | `simulator.addI2CDevice` (browser) |
| `wokwi-ili9341` (SPI TFT) | ✅ | ✅ | ❌ | `spi.onByte` (browser) |
| `wokwi-lcd2004` (parallel LCD) | ✅ | ✅ | ❌ | parallel pin monitor |
| **`epaper-ssd168x` (5 variants)** | **✅ ≤2.13"** | **✅** | **✅** | Browser decoder for AVR/RP2040; backend `Ssd168xEpaperSlave` for ESP32 — emits `epaper_update` WS events. See [`docs/wiki/epaper-emulation.md`](../../docs/wiki/epaper-emulation.md). |

**Nota ESP32**: el chip's `.wasm` corre en el proceso del worker QEMU (vía
[`wasmtime`](https://wasmtime.dev/)), así que **todas** las callbacks
(I2C / SPI / UART / pin_watch / timers) responden a QEMU **sincrónicamente** —
misma fidelidad que los slaves Python hardcodeados (`MPU6050Slave`, etc) y
sin round-trip por WebSocket. Ver
[`docs/wiki/custom-chips-esp32-backend-runtime.md`](../../docs/wiki/custom-chips-esp32-backend-runtime.md)
para la arquitectura completa, incluyendo el reference de op codes picsimlab.

## Cómo se validó cada uno

### AVR (Uno/Nano/Mega)
- 70 tests en `test/test_custom_chips/test/` con `avr8js` real cargando `.hex` real
  de un sketch Arduino (incluye el sketch I2C `i2c_eeprom_demo.ino` compilado con
  `arduino-cli`).
- Chip 24C01 contesta correctamente al `Wire.h` del sketch — full I2C E2E.

### ESP32 (lcgamboa QEMU + backend WASM runtime)
- `test/test_custom_chips_boards/test_esp32_gpio_bridge.py` (2 tests) — GPIO + serial
  round-trip básico, sin WASM.
- `test/test_custom_chips_boards/test_esp32_chip_i2c.py` (1 test) — sketch ESP32 con
  `Wire.h` ↔ chip 24C01 EEPROM. Valida pointer write, data write, pointer reset,
  read 4 bytes round-trip.
- `test/test_custom_chips_boards/test_esp32_chip_uart.py` (1 test) — sketch envía
  "Hello", chip ROT13 transforma byte a byte, sketch lee bytes transformados.
- `test/test_custom_chips_boards/test_esp32_chip_spi.py` (1 test) — sketch hace
  `SPI.transfer(0xA5)` + RCLK pulse, chip 74HC595 latch a 8 GPIO outputs, sketch
  lee `Q=10100101` LSB-first. Valida la cadena completa: SPI byte → on_done →
  pin_watch en RCLK → vx_pin_write → `qemu_picsimlab_set_pin` → `digitalRead`.
- `test/test_chip_backend_runtime/test_wasm_runtime.py` (11 tests) — runtime
  Python aislado (sin QEMU): inverter, EEPROM 24C01 + pointer wrap, EEPROM 24LC256,
  GPIO output, UART ROT13, SPI shift register, timer plumbing, pin_watch edge.

### Compilación multi-board
- `test_multi_board_sketch_compile.py` compila un blink simple en 5 boards
  representativos (Uno, Nano, Mega, Pi Pico, ESP32). Todos pasan en ~90 s.

## Gaps documentados (follow-ups)

### Alta prioridad
1. **ESP32-C3 — exponer USART/I2C/SPI MMIO**. El simulator JS hoy hace stubs;
   habría que rutear las MMIO regions a un bus equivalente al del AVR. Alternativa:
   replicar el patrón ESP32 — el lcgamboa fork ya tiene `esp32c3_picsimlab.c`
   con los mismos hooks `picsimlab_i2c_event`/`spi_event`/`uart_tx_event` y los
   eventos picsimlab tienen el mismo encoding, así que el `WasmChipRuntime`
   funciona tal cual. Falta agregar el branch `custom-chip` en el worker C3.

### Baja prioridad
- **ATtiny85 — añadir USI** (peripheral 2-wire). Avr8js puede no soportarlo;
  validar primero.
- **Raspberry Pi 3 — bridge a I2C real del kernel** dentro del QEMU. Más
  complejo, depende del firmware.
- **ESP32 framebuffer/display** — chips con `vx_framebuffer_init` hoy emiten
  `chip_warning`; falta forwardear pixel updates al canvas del frontend vía
  WebSocket (async, no en hot path).
- **ESP32 `vx_pin_dac_write`** — hook a `qemu_picsimlab_set_apin` (~30 min).

## Cómo correr la validación localmente

```bash
# 1. Backend (con lcgamboa lib disponible — ver paso 0 abajo si falta)
cd backend && uvicorn app.main:app --port 8765

# 2. Suite multi-board pytest
cd .. && VELXIO_BACKEND_URL=http://127.0.0.1:8765 \
    python -m pytest test/test_custom_chips_boards/ -v

# 3. Sandbox AVR (browser-side via avr8js + Vitest)
cd test/test_custom_chips && npm test
```

### Paso 0 — Cómo conseguir libqemu-xtensa.dll/.so en dev local

El `Dockerfile.standalone` la trae como parte del build. Si tenés un container
de Velxio corriendo:

```bash
# Windows / dev local
docker cp velxio-dev:/app/app/services/libqemu-xtensa.dll backend/app/services/
docker cp velxio-dev:/app/app/services/esp32-v3-rom.bin     backend/app/services/
docker cp velxio-dev:/app/app/services/esp32-v3-rom-app.bin backend/app/services/
```

(Análogo en Linux con `.so`.) El backend la detecta en `LIB_PATH` y enruta
ESP32 a través de la C library en lugar del subprocess fallback.
