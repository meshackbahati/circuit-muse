# rp2040js — what's already there to hook into

This is a **read-the-source** inventory of the bits of
`third-party/rp2040js` we'd build on top of. Paths are relative to
`third-party/rp2040js/src/`.

## Core peripherals already present

| Peripheral | File | Coverage | Useful for CYW43 emulator? |
|---|---|---|---|
| Cortex-M0+ core | `cortex-m0-core.ts` | Full ARMv6-M | n/a — runs the driver code |
| GPIO | `gpio-pin.ts` | Drive/sense per pin | Yes — for WL_REG_ON, IRQ |
| PIO (×2, 4 SMs each) | `peripherals/pio.ts` (`RPPIO`, `StateMachine`) | Instruction-level emulation, side-set, autopush/pull, FIFOs | **Critical** — this is where the gSPI bus actually runs |
| SPI (PL022) | `peripherals/spi.ts` | Master/slave registers | Not used by CYW43; driver uses PIO instead |
| DMA | `peripherals/dma.ts` | Channels + DREQ | Yes — driver uses DMA for >32 byte transfers |
| Clocks | `peripherals/clocks.ts` | Stub-ish but functional | Fine |
| USB CDC | `usb/` | Full | Unrelated |

## The PIO is the entry point

`StateMachine.run()` runs one PIO instruction per call. Every
`out pins, n` and `in pins, n` instruction passes through the same JS
object. The `RPPIO` instance holds 4 `StateMachine`s each, with
`txFifo` / `rxFifo` accessible. Velxio already monkey-patches it once:

```ts
// frontend/src/simulation/RP2040Simulator.ts:172-184
for (const pio of (this.rp2040 as any).pio) {
  const original = pio.run.bind(pio);
  pio.run = function (this: any) { original(); /* ... */ };
}
```

So **we already step the PIO ourselves** and have full visibility into
each state machine's GPIO writes. That is exactly the seam a CYW43
emulator needs.

## GPIO write/read is observable

`gpio-pin.ts` exposes:

```ts
class GPIOPin {
  inputValue: boolean;
  setInputValue(value: boolean): void;
  // The CPU/PIO drive output via internal state; we observe by
  // monitoring `gpioState` on the rp2040 instance.
}
```

`RP2040Simulator` already converts these to `onPinChange(pin, state, t)`
callbacks (line 63 of the wrapper). For the CYW43 path we need three
specific pins:

| GPIO | Role on Pico W |
|---|---|
| 23  | `WL_REG_ON` — power-up signal (host drives high to wake the chip) |
| 24  | `WL_DATA_IN` / `WL_DATA_OUT` (half-duplex, mode-switched), also IRQ when host releases the line |
| 25  | `WL_CS_OUT` — chip-select, **and** on plain Pico this is `LED_BUILTIN`. On Pico W the LED is wired through the CYW43 instead, so emulator must own this pin. |
| 29  | `WL_CLOCK` — gSPI SCK (also the default ADC voltage divider pin on plain Pico — Pico W remaps it) |

Note pin 25 is **the LED** on plain Pico but is **CS** on Pico W — and
the LED is then driven from inside the CYW43 chip. This is the
single biggest difference between the two boards visible to a user, and
it's the only Pico-W feature that fails *silently* (you ask for the LED
and nothing happens).

## What rp2040js does NOT have

- **No NIC abstraction** — there is no equivalent of QEMU's `-nic user,model=...`.
- **No way to flash the closed CYW43 firmware blob** through any peripheral —
  but we don't *want* to "execute" 224 KB of unknown ARM thumb code, we just
  want to *acknowledge* it (more on that in `04_emulation_design.md`).
- **No SDIO peripheral** — fine, the Pico W uses gSPI not SDIO.
- **No 802.11 frame format support** — also fine, see Tier 2 vs 3 in the
  design doc.

## Verdict

The plumbing is in place. We need to build a `Cyw43Emulator` class that
attaches itself to:

1. The four PIO state machines (read TX FIFO, write RX FIFO).
2. Three GPIO pins (23/25, plus IRQ generation onto 24 in input mode).
3. A virtual network sink (slirp-equivalent or a JS userspace TCP/UDP).

The CPU never has to know.
