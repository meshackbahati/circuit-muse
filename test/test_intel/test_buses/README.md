# test_buses — External memory chips for retro CPUs

Real PCBs from 1976 don't put RAM/ROM inside the CPU package. Faithful
emulation requires the same separation: the CPU drives address pins,
chip-select, and RD̅/WR̅; separate memory chips on the canvas listen.

These chips are reusable across all five Intel/Z80 CPU projects.

## Chips planned

| Chip          | Pins | Source file       | Status |
| ------------- | ---- | ----------------- | ------ |
| `rom-32k`     | 27   | `rom-32k.c`       | ✅ Implemented — 6/6 tests passing |
| `ram-64k`     | 29   | `ram-64k.c`       | ✅ Implemented — 7/7 tests passing |
| `latch-8282`  | 20   | `latch-8282.c`    | 📋 Spec only (only needed for 8086) |

## Why we still test these C chips even though tests use `installFakeRom`

The `BoardHarness.installFakeRom()` and `installFakeRam()` helpers
emulate memory in JS for **CPU unit tests**. They are fast, flexible,
and don't require a per-test compile.

The real `rom-32k.c` / `ram-64k.c` chips are needed because:

1. **End users wire them on the canvas.** A user dropping a Z80 into
   velxio expects a draggable ROM and RAM next to it. The C chips ARE
   that user-visible primitive.
2. **Integration tests need the real chip.** Once a CPU is verified
   in unit tests with a fake ROM, an integration test runs the same
   CPU with the **real** `rom-32k.wasm`, proving the on-canvas demo
   will work.

So the test split is:

- `*.unit.test.js` → uses `installFakeRom` / `installFakeRam`,
  tests instruction semantics and bus protocol
- `*.integration.test.js` → uses real compiled bus chips, proves the
  user-visible demo works

For now we have `rom-32k.test.js` and `ram-64k.test.js` covering the
**C chip** behavior in isolation — pin contract + read/write protocol
with hand-crafted bus stimuli.

## ROM image loading — the SDK constraint

The velxio chip SDK does not (yet) support arbitrary-length blob
attributes. `vx_attr_register` only takes a `double`. So a 32 KB ROM
image cannot be passed in via `.chip.json` properties.

**Workaround for now:** the C source contains
`const uint8_t rom_image[32768] = { /* baked-in */ };`. Each "ROM
variant" is a separate compiled chip. For shipping examples we will
generate one variant per demo program; for tests we use a small image
embedded directly in `rom-32k.c`.

A follow-up SDK proposal — adding `vx_attr_register_blob()` or an
"asset" import mechanism — is tracked in
[../autosearch/05_open_questions.md](../autosearch/05_open_questions.md#q4-how-are-chip-config-blobs-rom-images-wired).

## ram-64k notes

The RAM chip is simpler — no embedded image, just a `static uint8_t
mem[65536]` zero-initialized at chip_setup. No SDK extension required.
