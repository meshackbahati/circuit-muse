# Custom Chips — Build & Test guide

Toolchain setup, compilation pipeline, and testing — both the in-app
"Compile" button and the local sandbox suite (70+ regression tests).

---

## Table of contents

- [Toolchain at a glance](#toolchain-at-a-glance)
- [Installing WASI-SDK](#installing-wasi-sdk)
- [Compiling a single chip](#compiling-a-single-chip)
- [Compiling via the backend API](#compiling-via-the-backend-api)
- [The sandbox test suite](#the-sandbox-test-suite)
- [Multi-board validation suite](#multi-board-validation-suite)
- [Writing tests for your own chip](#writing-tests-for-your-own-chip)
- [Troubleshooting](#troubleshooting)

---

## Toolchain at a glance

The whole compilation pipeline is **two open-source tools** plus our header:

| Component | What it does | License |
|---|---|---|
| **clang** (from WASI-SDK) | Compiles C → WebAssembly | Apache 2.0 |
| **wasi-libc** (from WASI-SDK) | C standard library (`malloc`, `printf`, `memset`, …) | MIT |
| **`velxio-chip.h`** | The Velxio chip API header | MIT (Velxio) |

No third-party simulator code is involved. The Velxio backend Docker image
bundles WASI-SDK at `/opt/wasi-sdk` automatically; for local dev you install
it once.

---

## Installing WASI-SDK

WASI-SDK is a single tarball with everything needed: clang, wasi-libc,
runtime libraries.

Releases: <https://github.com/WebAssembly/wasi-sdk/releases>

### Linux / macOS

```bash
cd /opt
sudo curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-linux.tar.gz \
   | sudo tar -xz
sudo mv wasi-sdk-22.0 wasi-sdk
echo 'export WASI_SDK=/opt/wasi-sdk' >> ~/.bashrc
export WASI_SDK=/opt/wasi-sdk
```

### Windows (PowerShell)

```powershell
$ErrorActionPreference = 'Stop'
$tmp = "$env:TEMP\wasi-sdk.tar.gz"
Invoke-WebRequest `
  https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-mingw.tar.gz `
  -OutFile $tmp
tar -xzf $tmp -C C:\
Move-Item C:\wasi-sdk-22.0 C:\wasi-sdk
[Environment]::SetEnvironmentVariable('WASI_SDK', 'C:\wasi-sdk', 'User')
$env:WASI_SDK = 'C:\wasi-sdk'
```

Reopen your terminal so the env var sticks, then verify:

```bash
$WASI_SDK/bin/clang --version
# clang version 22.x ... Target: wasm32-unknown-wasip1
```

If your installed version reports a different default target, pass
`--target=wasm32-unknown-wasip1` explicitly (the compile script already does).

### Verify the backend has it

When the backend is running:

```bash
curl http://localhost:8001/api/compile-chip/status
# {"available":true,"wasi_sdk":"/opt/wasi-sdk","sdk_include":"/app/sdk"}
```

If `available: false`, set `WASI_SDK` and restart uvicorn, or rebuild the
Docker image.

---

## Compiling a single chip

The exact command Velxio uses internally:

```bash
$WASI_SDK/bin/clang \
  --target=wasm32-unknown-wasip1 \
  -O2 \
  -nostartfiles \
  -Wl,--import-memory \
  -Wl,--export-table \
  -Wl,--no-entry \
  -Wl,--export=chip_setup \
  -Wl,--allow-undefined \
  -I /path/to/sdk/include \
  mychip.c -o mychip.wasm
```

### Each flag explained

| Flag | Why |
|---|---|
| `--target=wasm32-unknown-wasip1` | Backend = WASM, libc = WASI preview-1 |
| `-O2` | Reasonable optimisation; `-Os` is fine too if you want smaller |
| `-nostartfiles` | No `crt0` — the chip has no `main()` |
| `-Wl,--import-memory` | The host provides the WASM linear memory |
| `-Wl,--export-table` | Exposes the function table so the host can invoke C function pointers (used for I2C / SPI / pin-watch callbacks) |
| `-Wl,--no-entry` | No `_start` function, only exports |
| `-Wl,--export=chip_setup` | Guarantees `chip_setup` survives DCE if linker is aggressive |
| `-Wl,--allow-undefined` | Treat unresolved `vx_*` symbols as WASM imports (the host provides them) |

### Convenience scripts

The sandbox ships ready-to-use scripts:

```bash
# Linux/macOS
bash test/test_custom_chips/scripts/compile-chip.sh \
     mychip.c fixtures/mychip.wasm

# Windows
.\test\test_custom_chips\scripts\compile-chip.ps1 `
     mychip.c fixtures\mychip.wasm
```

Both auto-discover `WASI_SDK` from common install paths.

---

## Compiling via the backend API

When the Custom Chip designer in the UI says "Compile", it `POST`s to:

```
POST /api/compile-chip/
Content-Type: application/json

{
  "source": "<full chip.c text>",
  "chip_json": "<full chip.json text — currently ignored, future use>"
}
```

Response:

```json
{
  "success": true,
  "wasm_base64": "AGFzbQEAAAAB...",
  "stdout": "",
  "stderr": "",
  "error": null,
  "byte_size": 63287
}
```

On compile errors `success` is `false` and `stderr` contains the clang
output. The endpoint never returns 5xx — it surfaces compiler errors as
data so the UI can show them.

You can also hit the endpoint manually:

```bash
curl -X POST http://localhost:8001/api/compile-chip/ \
  -H 'Content-Type: application/json' \
  -d "$(jq -Rn --rawfile s mychip.c '{source: $s}')"
```

A status endpoint reports availability:

```bash
curl http://localhost:8001/api/compile-chip/status
```

---

## The sandbox test suite

Velxio ships a Node.js sandbox at
[`test/test_custom_chips/`](../../test/test_custom_chips/) that mirrors the
production runtime. It uses the **same** chip API, the **same** I2C bus
manager, and the **same** `avr8js` instance the browser uses — all the
chips work identically.

### Quick start

```bash
cd test/test_custom_chips
npm install

# Build all 11 example chip fixtures (.wasm) — needs WASI-SDK
bash scripts/compile-all.sh

# Run the test suite
npm test
```

Expected output:

```
Test Files  26 passed (26)
Tests       70 passed (70)
```

### What it tests

| Layer | Tests |
|---|---|
| `PinManager` mirror | Edge dispatch, PWM, analog, unsubscribe (5 tests) |
| `I2CBus` mirror | TWI event handler, address routing, NACK (3 tests) |
| `AVRHarness` | `avr8js` boots a real `blink.hex` (2 tests) |
| `ChipRuntime` host imports | Surface check, missing-import error reporting (4 tests) |
| Single chip behavior | Each of the 11 example chips (3-5 tests each) |
| Multi-chip | Chained logic, two EEPROMs, mixed I2C+UART (4 tests) |
| AVR + chip integration | `avr8js` blink hex driving a real chip (3 tests) |
| Full E2E with `Wire.h` | Compiled Arduino sketch + 24C01 EEPROM (1 test) |
| API extras | OUTPUT_LOW/HIGH, pin_watch_stop, DAC (4 tests) |

### Running just one suite

```bash
npm run test:js     # JS-only (no WASM needed) — 14 tests
npm run test:e2e    # Tests requiring compiled .wasm — 7 tests
```

---

## Multi-board validation suite

The pytest suite at
[`test/test_custom_chips_boards/`](../../test/test_custom_chips_boards/)
exercises the **backend** services that custom chips depend on, across all
supported board families.

### Pre-requisites

- Backend running. By default the suite expects `http://127.0.0.1:8765`.
  Override with `VELXIO_BACKEND_URL`.
- For ESP32 tests: the lcgamboa `libqemu-xtensa.{dll,so}` must be at
  `backend/app/services/`. The Docker image bundles it; for local dev
  you can `docker cp` it from a running container.

### Running

```bash
cd /path/to/velxio
VELXIO_BACKEND_URL=http://127.0.0.1:8765 \
   pytest test/test_custom_chips_boards/ -v
```

Expected: 24 tests pass.

| Test file | Validates |
|---|---|
| `test_compile_endpoint.py` | All 11 chips compile via `/api/compile-chip` (14 tests) |
| `test_multi_board_sketch_compile.py` | Blink sketch builds for AVR/RP2040/ESP32 (5 tests) |
| `test_esp32_gpio_bridge.py` | ESP32 QEMU GPIO + serial round-trip via WS (2 tests) |
| `test_esp32_chip_i2c.py` | ESP32 sketch ↔ chip 24C01 EEPROM (Wire round-trip via backend WASM runtime) |
| `test_esp32_chip_uart.py` | ESP32 sketch ↔ chip ROT13 (Serial.write/read via backend WASM runtime) |
| `test_esp32_chip_spi.py` | ESP32 sketch ↔ chip 74HC595 (SPI byte + RCLK pin_watch + 8 GPIO outputs) |

The ESP32 tests skip cleanly if `libqemu-xtensa` is missing.

For pure-runtime tests (no QEMU, no WebSocket, just the Python WASM runtime in
isolation) see [`test/test_chip_backend_runtime/test_wasm_runtime.py`](../../test/test_chip_backend_runtime/test_wasm_runtime.py)
— 11 tests covering GPIO, I2C, UART, SPI, pin_watch and timers. Run with
`pytest test/test_chip_backend_runtime/`.

---

## Writing tests for your own chip

Inside the sandbox, drop a test file under
`test/test_custom_chips/test/chips/your_chip.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('mychip');

describe('My chip', () => {
  it.skipIf(skip)('does the thing', async () => {
    const pm = new PinManager();
    const chip = await ChipInstance.create({
      wasm: loadChipWasm('mychip'),
      pinManager: pm,
      wires: new Map([['IN', 2], ['OUT', 3]]),
    });
    chip.start();

    pm.triggerPinChange(2, true);
    expect(pm.getPinState(3)).toBe(false);

    chip.dispose();
  });
});
```

For an I2C chip, instantiate an `I2CBus`:

```js
import { I2CBus } from '../../src/I2CBus.js';
import { makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const twi = makeFakeTwi();
const bus = new I2CBus(twi);
const chip = await ChipInstance.create({
  wasm: loadChipWasm('mychip'),
  pinManager: pm,
  i2cBus: bus,
  wires: new Map([['SDA', 18], ['SCL', 19]]),
});
chip.start();

i2cWrite(bus, twi, 0x50, [0x00, 0xAA]);          // pointer=0, data=0xAA
i2cWrite(bus, twi, 0x50, [0x00]);                // reset pointer
expect(i2cRead(bus, twi, 0x50, 1)).toEqual([0xAA]);
```

For a SPI chip, use `SPIBus`:

```js
import { SPIBus } from '../../src/SPIBus.js';

const spi = new SPIBus();
const chip = await ChipInstance.create({
  wasm: loadChipWasm('mychip'),
  pinManager: pm,
  spiBus: spi,
  wires: new Map([['SCK', 13], ['MOSI', 11], ['MISO', 12], ['CS', 10]]),
});
chip.start();

pm.triggerPinChange(10, false);                  // CS LOW
const responses = spi.transferBytes([0x01, 0xA0, 0x00]);
pm.triggerPinChange(10, true);                   // CS HIGH
expect(responses[2]).toBe(/* expected */);
```

For full E2E with a real Arduino sketch, see
[`test/test_custom_chips/test/e2e/07_chip_eeprom_avr_e2e.test.js`](../../test/test_custom_chips/test/e2e/07_chip_eeprom_avr_e2e.test.js)
— it loads a compiled `.hex` of `Wire.h` code into `avr8js` and runs the
chip alongside.

---

## Troubleshooting

### Compile errors

**`undefined symbol: vx_pin_register`**
You forgot `-Wl,--allow-undefined`. The compile scripts already include
this — if you're invoking clang manually, add the flag.

**`#include "velxio-chip.h" — file not found`**
You missed `-I path/to/sdk/include`. The header lives at
`test/test_custom_chips/sdk/include/velxio-chip.h` (sandbox) or
`backend/sdk/velxio-chip.h` (backend).

**`error: "vx_i2c_config must be 64 bytes"` (static assert)**
Your local header is out of sync with the runtime. Re-pull the latest
`velxio-chip.h` from `backend/sdk/`.

**`argument '--target=wasm32-wasi' is deprecated`**
You're using the old target name. The compile scripts use
`wasm32-unknown-wasip1` (the modern equivalent). Update your invocation.

### Runtime errors

**Chip console: `Chip WASM imports missing in host: env.foo_bar`**
Your chip uses an extern that the runtime doesn't provide. Either:
- The function name is wrong (typo of a `vx_*` function).
- You added a custom `extern` thinking the host would provide it. The
  host only provides the functions in `velxio-chip.h`.

**Chip seems to do nothing on canvas**
- Is the chip wired? Open the chip and check pins are connected to the
  Arduino.
- Is the simulation running?
- Did `chip_setup` complete? Look at `[chip:<id>]` lines in the browser
  console — `vx_log` and `printf` output land there.

**Chip works in the sandbox but not in the browser**
- Did you click "Compile" + "Save & Place" after editing the C? The
  `wasm_base64` is embedded into the component's properties at save time.
- For AVR / RP2040, the chip runs in the browser. For ESP32, the chip runs in
  the **backend Python process** — see
  [`custom-chips-esp32-backend-runtime.md`](./custom-chips-esp32-backend-runtime.md)
  for the architecture. If logs and pin updates don't appear, check the
  worker stderr in the backend logs (search for `[custom-chip]`).
- Check the [board support matrix](../../test/autosearch/07_multi_board_support.md)
  for protocol coverage per board.

### ESP32 specific

On ESP32 the chip's `.wasm` is loaded inside the same Python process that
hosts QEMU (`backend/app/services/wasm_chip_runtime.py` via wasmtime). All
peripheral callbacks fire **synchronously** in the QEMU thread:

| Chip API | ESP32 hook | Notes |
|---|---|---|
| `vx_pin_write` | `qemu_picsimlab_set_pin(gpio + 1, value)` | Drives GPIO input |
| `vx_pin_read` | Cached `_pin_state[gpio]` from `_on_pin_change` | Live |
| `vx_pin_watch` | Dispatched from `_on_pin_change` (edge filtered) | Sync, lock held |
| `vx_i2c_attach` | Registered as `_i2c_slaves[addr]` | `_on_i2c_event` |
| `vx_uart_attach` / `vx_uart_write` | `_on_uart_tx` ↔ `qemu_picsimlab_uart_receive` | UART0 only |
| `vx_spi_attach` | Dispatched from `_on_spi_event` (op = `data << 8`) | Re-arm pattern supported |
| `vx_timer_*` | Dedicated scheduler thread that takes the IO-thread lock | Wakes on soonest deadline |

`chip_log` and `chip_error` events flow back over the WebSocket as a
telemetry channel. Stubs (`vx_pin_dac_write`, framebuffer) emit `chip_warning`
instead of crashing.

**ESP32 QEMU exits immediately, "unsupported machine type: esp32"**
The upstream `qemu-system-xtensa` binary doesn't include the ESP32 machine
model. Velxio uses the **lcgamboa fork** as a shared library
(`libqemu-xtensa.dll/.so`). The Docker image bundles it; for native dev,
copy it from a running container:

```bash
docker cp velxio-dev:/app/app/services/libqemu-xtensa.dll \
          backend/app/services/
```

Then restart uvicorn so it picks up `LIB_PATH`.

### File-size sanity

A typical chip is **40-80 KB** of WASM (most of that is wasi-libc's
`malloc`/`printf` family). If yours is dramatically larger, check whether
you're pulling in `<math.h>` or `<stdio.h>` features you don't need.
Replacing `printf` with `vx_log` shaves about 15 KB.

If yours is smaller than 1 KB, something probably went wrong — the host
expects a real WASM module with the magic bytes `\x00asm`. Run
`xxd mychip.wasm | head -2` to confirm the magic.
