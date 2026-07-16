# Sources — fetched 2026-04-28

All findings in this folder trace back to the URLs below. URLs are
date-stamped because closed-source comments and forum threads do
disappear; if you need to verify a quote, prefer the canonical
documentation/source over the forum reproduction.

## Primary sources (datasheets, spec)

- [CYW43439 Datasheet v05.00 — Infineon](https://storage.googleapis.com/media.amperka.com/products/raspberry-pi-pico-w/media/infineon-cyw43439-datasheet.pdf)
  Official register map and gSPI protocol.
- [CYW43439 Datasheet v03.00 — Mouser mirror](https://www.mouser.com/datasheet/2/196/Infineon_CYW43439_DataSheet_v03_00_EN-3074791.pdf)

## Driver source — the "what does the host write" reference

- [pico-sdk · `pico_cyw43_driver/cyw43_bus_pio_spi.c`](https://github.com/raspberrypi/pico-sdk/blob/master/src/rp2_common/pico_cyw43_driver/cyw43_bus_pio_spi.c)
- [pico-sdk · `pico_cyw43_driver/cyw43_bus_pio_spi.pio`](https://github.com/raspberrypi/pico-sdk/blob/master/src/rp2_common/pico_cyw43_driver/cyw43_bus_pio_spi.pio)
- [georgerobotics/cyw43-driver · `src/cyw43_ll.c`](https://github.com/georgerobotics/cyw43-driver/blob/main/src/cyw43_ll.c) — bus-init, IOCTL set
- [georgerobotics/cyw43-driver · `src/cyw43_ctrl.c`](https://github.com/georgerobotics/cyw43-driver/blob/main/src/cyw43_ctrl.c) — control plane
- [georgerobotics/cyw43-driver · firmware/](https://github.com/georgerobotics/cyw43-driver/tree/main/firmware) — the blob (do not redistribute)
- [georgerobotics/cyw43-driver · README](https://github.com/georgerobotics/cyw43-driver/blob/main/README.md) — license terms

## Alternate driver implementations (cross-checks)

- [embassy-rs/cyw43 (archived; merged into embassy)](https://github.com/embassy-rs/cyw43)
- [soypat/cyw43439 (TinyGo)](https://github.com/soypat/cyw43439)
- [soypat/cyw43439 — WHD package docs](https://pkg.go.dev/github.com/soypat/cyw43439/whd)
- [PicoWi part 1 — Iosoft blog (gSPI walk-through)](https://iosoft.blog/2022/12/06/picowi_part1/)
- [PicoWi project page](https://iosoft.blog/2022/12/06/picowi/)

## Emulator side

- [wokwi/rp2040js — main repo](https://github.com/wokwi/rp2040js)
- [wokwi/rp2040js — issue #134 "Is there a way to emulate cyw43 using nodejs?"](https://github.com/wokwi/rp2040js/issues/134) — open, no maintainer reply
- [wokwi/rp2040js — releases](https://github.com/wokwi/rp2040js/releases)
- [c1570/rp2040js fork (RP2350 support)](https://github.com/c1570/rp2040js)
- [wokwi/wokwigw — Wokwi IoT network gateway](https://github.com/wokwi/wokwigw) — what we'd mirror for Tier 2 transport

## Forum / discussion (lower confidence, useful for context)

- [Custom code on the Pico W CYW43439 — RPi forums](https://forums.raspberrypi.com/viewtopic.php?t=336860)
- [Register-level documentation for CYW43439 — RPi forums](https://forums.raspberrypi.com/viewtopic.php?t=336824)
- [pico-sdk issue #2044 — CYW43 PIO ASM hardcoded for ARM](https://github.com/raspberrypi/pico-sdk/issues/2044)
- [pico-sdk issue #1351 — Pico W SPI state machine](https://github.com/raspberrypi/pico-sdk/issues/1351)
- [micropython issue #11247 — cyw43_spi_init bus_data assert](https://github.com/micropython/micropython/issues/11247)
- [micropython PR #16915 — lost CYW43 events on dual-core](https://github.com/micropython/micropython/pull/16915)

## Wokwi (closed source, observed behaviour only)

- [Wokwi ESP32 WiFi guide](https://docs.wokwi.com/guides/esp32-wifi) — the model we'd mirror
- [Pi Pico W on Wokwi (project listing)](https://wokwi.com/pi-pico)
- [Pico W WiFi WORKING — sample project](https://wokwi.com/projects/383488063347027969)
- [Pico W WiFi-NTP — sample project](https://wokwi.com/projects/360632327984826369)

## Velxio internal (this repo)

- `third-party/rp2040js/src/peripherals/pio.ts` — `RPPIO`, `StateMachine`
- `third-party/rp2040js/src/gpio-pin.ts`
- `frontend/src/simulation/RP2040Simulator.ts` — current wrapper
- `frontend/src/simulation/MicroPythonLoader.ts` — current MP firmware loader
- `frontend/src/types/board.ts` — `pi-pico-w` board declaration
- `backend/app/services/esp32_worker.py` — the slirp pattern we'd copy
