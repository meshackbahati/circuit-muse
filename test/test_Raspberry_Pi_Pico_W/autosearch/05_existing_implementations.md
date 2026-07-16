# Every CYW43-related codebase we found, classified

**Search cut-off:** 2026-04-28. Domains queried via WebSearch + GitHub.

| Project | URL | Direction | Language | License | Useful for our emulator? |
|---|---|---|---|---|---|
| georgerobotics/cyw43-driver | https://github.com/georgerobotics/cyw43-driver | host → chip | C | RP-noncommercial / commercial | **Reference implementation.** Read `cyw43_ll.c` to know exactly what the driver writes. Don't redistribute. |
| pico-sdk pico_cyw43_driver | https://github.com/raspberrypi/pico-sdk/tree/master/src/rp2_common/pico_cyw43_driver | host → chip | C + PIO asm | BSD-3 | **Use freely.** The `cyw43_bus_pio_spi.{c,pio}` is the gSPI bit pattern emulator must match. |
| embassy-rs/cyw43 | https://github.com/embassy-rs/embassy/tree/main/cyw43 (the repo above is archived) | host → chip | Rust | Apache-2.0 / MIT | Cleanly-commented Rust port. Excellent secondary reference. |
| soypat/cyw43439 | https://github.com/soypat/cyw43439 | host → chip | Go (TinyGo target) | BSD-3 | Lots of comments and broken-out struct definitions; also has a docs index for the WHD command set. |
| iosoft/picowi | https://iosoft.blog/2022/12/06/picowi/ | host → chip | C | LGPL | Hand-written from datasheet, not pico-sdk-derived. Most readable. The blog series is the best protocol walkthrough on the open web. |
| tabemann/cyw43-firmware | https://github.com/tabemann/cyw43-firmware | firmware mirror | binary | non-redistributable | Just hosts the blob. Can't ship it without Infineon's go-ahead. |
| wokwi/wokwigw | https://github.com/wokwi/wokwigw | network gateway | Go | MIT | **Not** chip emulation. It's the slirp-replacement that bridges simulator network packets to the host network. Reusable for our Tier-2 backend bridge. |
| wokwi/rp2040js | https://github.com/wokwi/rp2040js | RP2040 emulator | TypeScript | MIT | Where we plug in. Open issue #134 confirms there's no upstream CYW43 work. |
| c1570/rp2040js fork | https://github.com/c1570/rp2040js | RP2040+RP2350 emulator | TypeScript | MIT | Adds RP2350 support, no WiFi. |

## What's NOT out there

- **No JavaScript / TypeScript / WASM CYW43 emulator** — confirmed.
- **No QEMU device model** for CYW43439. There is a generic `bcm2835_emmc` for full-fat Broadcom WLAN found in the Raspberry Pi 3 model, but it's emmc/SDIO and only models bus-level activity, not 802.11.
- **No CocoTB / Verilator-based "real" simulation** of the chip's
  internal MAC. This makes sense — the RTL is closed.
- **No published reverse engineering of the firmware blob** beyond the
  Iosoft blog series identifying packet headers in a hex dump.

## What IS out there but not relevant

- The `whd` (WiFi Host Driver) source from Infineon's GitHub is the
  same code as cyw43-driver upstream, just with the original Infineon
  abstraction layers. Same direction, same constraint.
- "Pi Pico W simulator" pages on mid-tier tech blogs are all wrappers
  around Wokwi or Tinkercad — none open-source the chip side.

## Conclusion

We are first. The existing code answers "what does the *host* write?"
exhaustively. Nobody has built the other half. That is what's in scope
here.
