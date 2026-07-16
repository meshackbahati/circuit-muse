# Can Velxio ship the 224 KB CYW43 firmware blob?

Short answer: **we don't need to**, and that's the cleanest answer for
both legal and engineering reasons.

## Why people think we'd need to ship it

The host driver streams 224 KB of opaque bytes (the WiFi firmware) plus
a ~2 KB NVRAM image plus a ~7 KB CLM (regulatory) blob into the chip's
RAM at boot. On real hardware the chip's internal Cortex-R4 then jumps
to the loaded code and runs the radio MAC.

Naively, an emulator would have to either:

1. **Execute the blob** on a virtual Cortex-R4 — out of scope (see
   `04_emulation_design.md` §"Why not just call the real chip"). The
   blob also drives unmodeled radio hardware, so even with a working
   CR4 it would just deadlock on a missing peripheral.
2. **Ship the blob** so the bit-pattern is at least byte-identical to
   real hardware — but nobody reads it back, so there's no benefit.

## What the driver actually checks after firmware load

From `cyw43_ll.c::cyw43_ll_bus_init()` post-firmware-stream:

1. Re-enable the WLAN core (write to AI control register via F1).
2. Poll `SDIO_CHIP_CLOCK_CSR` for `SBSDIO_HT_AVAIL` bit.
3. Read a few status registers to confirm the chip "boots".
4. Send IOCTL `cur_etheraddr` to read the MAC address.

None of these read back any of the 224 KB. The driver trusts that if
it streamed N bytes and the chip didn't NACK, the firmware is in place.
It only verifies the chip is *alive*, not that it ran specific code.

So the emulator can:

- **Discard firmware writes** as they arrive (just track the
  auto-increment cursor and length).
- **Lie about HT_AVAIL** — flip the bit a few microseconds after the
  driver re-enables the core.
- **Synthesise a MAC address** for `cur_etheraddr` (use a stable
  per-instance value derived from the board's ID).

This is roughly what `iosoft/picowi` describes the chip doing post-load
anyway, just from the host's perspective.

## Legal status of the real blob

`georgerobotics/cyw43-driver/firmware/`:

> The contents of this directory are licensed for redistribution by
> Cypress Semiconductor Corporation under terms which are documented
> in the LICENSE.cypress and LICENSE.RP files in the root of this
> repository. The license restricts redistribution to use with
> CYW43xxx silicon products. Any use that is not in conjunction with
> CYW43xxx silicon products is prohibited.

A WASM/JS emulator distinctly is **not** a CYW43xxx silicon product.
Bundling the blob into Velxio's open-source repo is therefore not
clearly permitted by Infineon's license, even though it's bundled
freely in pico-sdk for use *with* the chip.

The path of least resistance and least legal risk:

> Don't ship it. Don't run it. Pretend it ran.

This is also what Wokwi appears to do, judging by their network-stack
behaviour (no firmware-version-specific quirks bleed through).

## What about the CLM (regulatory) blob?

Same calculus. The CLM is the chip's country code / channel-allowlist
table. The driver writes it, then sets a country code and queries it
back. The emulator just needs to **echo** the country code the driver
sets, not interpret CLM contents.

## What if a project depends on a firmware version string?

The driver exposes `wlan.config('mac')`, `'channel'`, `'ssid'`,
`'hostname'`, `'txpower'` — but not firmware version. MicroPython
doesn't surface it. Arduino-pico's `WiFi.firmwareVersion()` returns a
hard-coded string from the host SDK, not a chip query. So we are safe.

## Conclusion

No firmware ships. The blob lookup, write, and verify path is a no-op.
The driver gets what it needs from a small set of synthesised register
values and IOCTL responses. This is what makes a Tier-0 stub
implementable in a day rather than a quarter.
