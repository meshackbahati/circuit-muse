# Velxio custom-chip capabilities (as of 2026-04-29)

Sourced by reading the in-repo SDK and runtime; no external lookups
needed.

## Toolchain

- C source → WASM via **clang + WASI-SDK**, driven by
  `backend/app/services/chip_compile.py`.
- Build flags (from the same file):

  ```
  clang --target=wasm32-unknown-wasip1 -O2 -nostartfiles
        -Wl,--import-memory -Wl,--export-table -Wl,--no-entry
        -Wl,--export=chip_setup -Wl,--allow-undefined
        -I sdk/ chip.c -o chip.wasm
  ```

- Single mandatory export: `void chip_setup(void)`. Everything else is
  reactive: pin watch callbacks, timer callbacks, I²C/SPI/UART
  callbacks. There is no host-driven main loop and no
  `chip_loop()`-style polling hook.

## Memory per chip instance

From `frontend/src/simulation/customChips/ChipRuntime.ts:170`:

```ts
this.memory = new WebAssembly.Memory({ initial: 2, maximum: 16 });
```

- 2 pages × 64 KB = **128 KB initial**.
- Up to **16 pages = 1 MB max** per instance.
- Each chip instance gets its own linear memory — no shared globals
  between two instances of the same chip.
- WASI-SDK ships `malloc`/`free`/`memset`/etc., so dynamic allocation
  for register files, decoder tables, and prefetch queues is fine.

## Pin API (from `backend/sdk/velxio-chip.h`)

- `vx_pin_t vx_pin_register(const char* name, vx_pin_dir dir);`
- `vx_pin_read`, `vx_pin_write`, `vx_pin_set_dir` — for digital I/O.
- `vx_pin_watch(pin, edge, callback, user_data)` — edge can be
  `VX_RISING`, `VX_FALLING`, or `VX_BOTH`.
- `vx_pin_dac_write` / `vx_pin_read_analog` — analog (not needed for
  these CPUs but available).

There is **no fixed pin-count cap**. The SDK uses a dynamic `PinEntry[]`
table. The 40-pin DIP CPUs in scope (8080 / Z80 / 8086) are well within
this.

## Time and clocks

- `uint64_t vx_sim_now_nanos(void)` — simulated time, monotonic.
- `vx_timer_t vx_timer_create(void);`
- `vx_timer_start(timer, period_nanos, repeating, callback, user_data)`
- `vx_timer_stop(timer)`

This is the mechanism we will lean on hardest: a CPU emulator schedules
a repeating timer at the chip's clock period (e.g. 250 ns for 4 MHz Z80)
and the callback executes one instruction (or one machine cycle) per
firing.

## I/O helpers we will *not* use

I²C, SPI, UART, framebuffer helpers exist (see
`docs/wiki/custom-chips-api-reference.md`) but they are higher-level
slave/master abstractions. CPUs drive raw pins (RD, WR, MREQ, IORQ,
ALE, etc.), so we will register those as plain GPIOs and bit-bang the
bus protocol from the chip itself.

## Existing precedent in the repo

Eleven example chips live in `test/test_custom_chips/sdk/examples/`.
Closest relatives to a CPU:

- **`sn74hc595.c`** — proves a multi-step, clocked, stateful protocol
  (SPI shift-register + latch) works under the reactive callback model.
- **`ds3231.c`** — proves persistent register files (19 BCD registers
  with auto-increment) work.
- **`pulse-counter.c`** — proves a chip can react to many edges per
  second without dropping events.

No full CPU emulator exists yet in the repo; this folder is the first.

## Hard limits that matter for CPUs

| Limit                 | Value                | Comfortable for…           |
| --------------------- | -------------------- | --------------------------- |
| Linear memory         | 1 MB / instance      | Even a 64 KB Z80 RAM model + decoder tables fits, but external RAM should still live in a separate chip. |
| Pin count             | No hard cap          | 40-pin packages are fine. |
| Timer resolution      | Nanoseconds          | Up to ~10 MHz instruction rates are fine; sub-ns is not. |
| WASM execution budget | Set by host loop     | Need to keep per-callback work bounded — no infinite spin. |

## What is *not* available

- No direct shared-memory bus between chips. Two chips talk only via
  pin transitions on wires.
- No interrupt controller primitive — interrupts are just pin edges
  the CPU watches and reacts to (which is how the real silicon works
  anyway).
- No SPICE / analog simulation guarantees timing accuracy at the
  nanosecond level under load — we will treat the simulated nanosecond
  clock as the source of truth, not wall time.
