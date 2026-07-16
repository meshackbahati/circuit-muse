# A layered design for CYW43 emulation in Velxio

Four tiers, each strictly more capable than the previous. Build them
in order. Each tier is independently shippable.

## Tier 0 — "the LED works"

**Goal:** The on-board LED on Pico W (driven through the CYW43, not a
GPIO) blinks. No WiFi. No `network.WLAN`.

**Scope:**
- Detect the **two specific IOCTLs** the driver uses for
  `cyw43_arch_gpio_put(0, on)`: `WLC_SET_VAR` with name `gpioout`, value
  `<bitmask, mask>`. Map bit 0 → "LED on/off" → callback to Velxio.
- Everything else is a no-op stub (return zero, ack everything).

**LOC estimate:** ~300 lines of TypeScript in
`frontend/src/simulation/cyw43/Cyw43Emulator.ts`. Plus PIO bus sniffer
~150 lines. Total ~450.

**Test:** Existing 100-days `Pico_W_Async_LED_Control_MicroPython`
project — `Pin("LED", Pin.OUT).on()` should toggle a visible LED on the
Velxio canvas.

**What the user sees:** The LED works on Pico W projects. Wi-Fi calls
still fail, but they fail with `OSError: WiFi not connected` instead of
hanging on the test register.

## Tier 1 — "WLAN object exists, scan returns nothing"

**Goal:** `network.WLAN(network.STA_IF)` succeeds. `wlan.active(True)`
returns. `wlan.scan()` returns an empty list. `wlan.isconnected()`
returns False forever.

**Scope of additions on top of Tier 0:**
- Full F0 + F1 register map populated with realistic chip-ID, capabilities, MAC address.
- SDPCM frame parser/serialiser on F2.
- Ack of the ~25 IOCTLs the driver sends during init: `up`, `down`,
  `country`, `event_msgs`, `cur_etheraddr`, `pwr_save`, `mpc`,
  `bus:txglom`, `ampdu_ba_wsize`, `apsta`, etc. Most just need
  status=0 / empty payload.
- Stub responses for `WLC_SCAN` (return zero APs after 2 seconds).
- Synthesise WLC_E_LINK event with status=AUTHENTICATED so
  `wlan.active(True)` returns.

**LOC estimate:** +~600 LOC.

**Test:** All ten Pico W projects in `test_100_days/` reach `main.py`
without raising at import or `wlan.active()`.

## Tier 2 — "real WiFi over slirp, like ESP32"

**Goal:** `wlan.connect(SSID, PASS)` succeeds against a synthetic
`Velxio-Local` AP. `urequests.get('http://example.com')` works.

**Scope of additions:**
- Implement the IOCTL set for `WLC_SET_SSID`, `WLC_DISASSOC`,
  `bsscfg:sup_wpa`, `bsscfg:sup_wpa_psk`. These don't actually do
  WPA — we accept any password.
- Wire SDPCM channel 2 (data path) to a userspace TCP/IP stack:
  - **Option A** — port the existing JS port of slirp (used by some
    QEMU.js builds) and tunnel through host fetch().
  - **Option B** — terminate at L3: parse outgoing IP packets,
    proxy TCP streams to the browser's `WebSocket`/`fetch()` to
    avoid bundling a full TCP stack. Limited to TCP/UDP that the
    browser sandbox allows.
  - **Option C** — talk to a Velxio backend WebSocket that runs slirp
    in the FastAPI process, **identical to how the ESP32 path works
    today** (see `backend/app/services/esp32_worker.py`). This is
    the most consistent with current architecture and the path I'd
    recommend.

**LOC estimate:** +~800 LOC frontend + ~200 LOC backend bridge.

**Test:** WebSocket_LED_Control_using_Raspberry_Pi_Pico_W from the
100-days suite serves a control page reachable from Velxio's preview
iframe.

## Tier 3 — "full chip"

Bluetooth, monitor mode, packet injection, multi-AP, WPA3-SAE. **Not
worth doing.** Wokwi doesn't even ship Bluetooth on Pico W. Skip.

## Architecture sketch

```
┌────────────────────────────────────────────────────────────┐
│  RP2040Simulator.ts (existing wrapper)                     │
│                                                            │
│   rp2040 (rp2040js) ──── pio[0..1].StateMachine[0..3]      │
│        │                          ▲                        │
│        │ GPIO write/read          │ TX FIFO                │
│        ▼                          │ RX FIFO                │
│   ┌──────────────────────────────────────────────────┐    │
│   │  Cyw43Emulator (NEW)                             │    │
│   │  ├─ PioBusSniffer  ── decodes 32-bit gSPI words  │    │
│   │  ├─ F0Registers    ── handshake, IRQ mask        │    │
│   │  ├─ F1Backplane    ── chipcommon, fw window      │    │
│   │  ├─ SdpcmEncoder   ── frames in/out on F2        │    │
│   │  ├─ IoctlHandler   ── WLC_* / cur_etheraddr / …  │    │
│   │  └─ NetSink        ── outbound IP → backend WS   │    │
│   └──────────────────────────────────────────────────┘    │
│        │                                                   │
│        ▼ ws://localhost:8001/api/simulation/<id>          │
└────────────────────────────────────────────────────────────┘
              ▲
              │ JSON: { type: "picow_net_out", data: [bytes] }
              ▼
┌────────────────────────────────────────────────────────────┐
│  backend/app/services/picow_net_bridge.py (NEW, Tier 2+)   │
│  ├─ slirp via libslirp-python OR plain asyncio TCP proxy   │
│  └─ same WebSocket route as ESP32                          │
└────────────────────────────────────────────────────────────┘
```

The Cyw43Emulator is a frontend-only object until Tier 2. The backend
bridge is Tier 2+. The visual canvas integration is unchanged — Pico W
is still rendered as the same `wokwi-pi-pico-w` element; we just stop
ignoring its WiFi-related behaviour.

## Why not "just call the real chip"?

Two ideas come up that we need to rule out explicitly:

1. **Run the closed firmware blob inside our ARM Cortex-M0+ emulator.**
   The blob targets the chip's *internal* CPU (separate from the host
   M0+). It's a small Cortex-R4 inside the CYW43439 with peripherals we
   don't model and 802.11 hardware we'd have to emulate too. This is
   not a shortcut — it's the *opposite* of what we want.

2. **Talk to a real Pico W over USB.** Possible (`-device usb-cdc` style
   bridge) but defeats the "fully local" Velxio promise and only helps
   one user at a time.

Stub the chip. That's the design.
