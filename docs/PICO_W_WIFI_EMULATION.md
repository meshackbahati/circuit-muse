# Pico W Wi-Fi Emulation (CYW43439)

This document describes how Velxio emulates the Raspberry Pi Pico W's
on-board Wi-Fi chip (Infineon CYW43439). The integration mirrors the
existing ESP32 WiFi pipeline so the same UI, settings, and mental
model carries over.

## TL;DR

| Question | Answer |
|---|---|
| Does it work today? | Yes. `network.WLAN(STA_IF)`, `wlan.connect()`, `wlan.scan()`, `socket.send/recv`, `urequests`, `umqtt`, raw WebSocket — all functional. |
| Does the on-board LED on Pico W work? | Yes. The LED is wired through the CYW43 chip on real hardware — Velxio observes the `gpioout` IOCTL and toggles the canvas LED. |
| What SSID does it advertise? | `Velxio-GUEST` (BSSID `02:42:DA:42:00:01`, channel 6). Same naming convention as the ESP32 path. |
| Is the closed firmware blob shipped? | **No.** Velxio absorbs the 224 KB firmware-stream writes and synthesises the post-load chip state. See `docs/wiki/picow-cyw43-emulation.md`. |
| Where do TCP/UDP packets go? | Backend WebSocket bridge, same pattern as ESP32. |
| What about Bluetooth? | Out of scope (matches Wokwi). |
| What about ESP-NOW / 802.11 raw frames? | Out of scope — slirp only routes TCP/UDP. |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Frontend (browser)                                            │
│                                                                │
│   RP2040Simulator (rp2040js)                                   │
│        │                                                       │
│        │ PIO TX FIFO push hooks                                │
│        ▼                                                       │
│   Cyw43Emulator  ── full chip-side state machine               │
│   ├── PioBusSniffer  → decode 32-bit gSPI command words        │
│   ├── F0/F1 register state                                     │
│   ├── SDPCM/CDC framing on F2                                  │
│   ├── IOCTL handler (UP/DOWN/SCAN/SET_SSID/SET_VAR/...)        │
│   ├── Async event injection (LINK / SET_SSID / ESCAN_RESULT)   │
│   ├── Velxio-GUEST virtual AP                                  │
│   └── on-board LED IOCTL → canvas                              │
│        │ Ethernet frames (chip ↔ host)                         │
│        ▼                                                       │
│   Cyw43Bridge (WebSocket)                                      │
│        │                                                       │
└────────│───────────────────────────────────────────────────────┘
         │  ws://…/api/simulation/ws/<id>
         │  { type: 'start_picow' | 'stop_picow' | 'picow_packet_out' }
         │  { type: 'wifi_status' | 'picow_packet_in' }
         ▼
┌────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                             │
│                                                                │
│   picow_net_bridge.PicowNetManager                             │
│   ├── Per-instance state (sta_ip = 10.13.37.42)                │
│   ├── Layer-2 → Layer-3 demux (IPv4 only at first)             │
│   └── TCP/UDP fan-out to host network (slirp-style)            │
└────────────────────────────────────────────────────────────────┘
```

## Comparison with the ESP32 path

| Feature | ESP32 (existing) | Pico W (new) |
|---|---|---|
| Frontend bridge class | `Esp32Bridge` | `Cyw43Bridge` |
| WS message type prefix | `start_esp32`, `esp32_*` | `start_picow`, `picow_*` |
| Backend service | `esp_qemu_manager.py` (QEMU) | `picow_net_bridge.py` (no QEMU — chip is JS) |
| Where the CPU runs | Espressif QEMU (out-of-process) | rp2040js (in-page, no QEMU) |
| Where the WiFi chip runs | QEMU `esp32_wifi` NIC model | `Cyw43Emulator` (frontend) |
| Firmware blob shipped? | No (Espressif QEMU has it built-in) | **No** (synthesised post-load state) |
| Sample SSID | `Velxio-GUEST` | `Velxio-GUEST` |
| Auto-detect from sketch | Yes — `#include <WiFi.h>` etc. | Yes — `import network`, `network.WLAN`, `WiFi.begin(...)` |

## Files added/changed

```
frontend/src/simulation/cyw43/
├── index.ts                         barrel export
├── constants.ts                     F0/F1/WLC/WLC_E/SdpcmChannel
├── sdpcm.ts                         SDPCM + CDC + event-frame codec
├── virtual-ap.ts                    Velxio-GUEST single-source-of-truth
├── PioBusSniffer.ts                 32-bit gSPI command decoder
├── Cyw43Emulator.ts                 chip-side state machine
└── Cyw43Bridge.ts                   WS link to backend (ESP32-bridge twin)

frontend/src/simulation/RP2040Simulator.ts
  + attachCyw43() / detachCyw43() / installCyw43PioHooks()
  + PIO TX FIFO interception, RX FIFO repacking
  + onPicoWLed / onPicoWWifiUp listener slots

frontend/src/store/useSimulatorStore.ts
  + cyw43BridgeMap, getCyw43Bridge()
  + per-board attach when boardKind === 'pi-pico-w'
  + WiFi auto-detect from main.py / sketch.ino content

frontend/src/data/examples-picow-wifi.ts
  + 4 curated examples drawn from
    github.com/KritishMohapatra/100_Days_100_IoT_Projects

frontend/src/data/examples.ts
  + 'pi-pico-w' added to the boardType union
  + picowWifiExamples concatenated into exampleProjects

frontend/src/components/examples/ExamplesGallery.tsx
  + Pico W (Wi-Fi) board tab

frontend/src/__tests__/picow-cyw43-integration.test.ts
  + 6 frontend integration tests (barrel exports, handshake, IOCTL,
    bridge protocol shape)

backend/app/services/picow_net_bridge.py
  + PicowNetManager + start/stop/deliver_packet_out
  + IPv4 demux stub (TCP SYN logging at first iteration)

backend/app/api/routes/simulation.py
  + start_picow / stop_picow / picow_packet_out message types
```

## Settings + UX

### Auto-detect

Enabling Wi-Fi on a Pico W board is **automatic**. When the user clicks
Run, `useSimulatorStore.startBoard()` scans the active file group and
flips `cyw43Bridge.wifiEnabled` to true if any of the following appear:

```regex
import\s+network\b      # MicroPython network module
network\.WLAN           # explicit WLAN constructor
#include\s*<WiFi\.h>    # arduino-pico Wi-Fi
WiFi\.begin\(           # explicit AP join from C++
```

Same heuristic as the ESP32 path — see `useSimulatorStore.ts:921` for
the parallel ESP32 implementation.

### Manual override

For projects that need WiFi but don't match the heuristic (rare),
power users can `import { getCyw43Bridge } from '../store/useSimulatorStore'`
and set `wifiEnabled = true` before calling `connect()`. A future PR
should expose this via the same right-panel toggle the ESP32 has.

### Visual feedback

The board's `wifiStatus` in the simulator store is updated by the
backend's `wifi_status` events. UI components that already render the
ESP32 status banner pick up Pico W status without code changes — the
schema is identical (`{ status, ssid?, ip? }`).

## How the backend bridge differs from ESP32's

The ESP32 path runs Espressif's QEMU build with a `-nic
user,model=esp32_wifi` slirp NIC. QEMU does the IP/TCP termination
internally; the backend just shovels stdio.

For the Pico W there's no QEMU — the chip lives in JavaScript. The
backend bridge therefore **terminates Layer 2 itself** in pure Python:
parses Ethernet frames, demuxes by ethertype, and fans out to host
TCP/UDP sockets. Concretely:

| Layer | Implementation |
|---|---|
| Ethernet / ARP | `picow_net/protocols.py` + `arp.py` |
| IPv4 (header + checksum) | `protocols.py` + `checksums.py` (RFC 1071) |
| ICMP echo (ping) | `icmp.py` — synthesises Echo Reply for any Echo Request |
| DHCP server | `dhcp.py` — DISCOVER → OFFER, REQUEST → ACK with proper option layout (RFC 2131) |
| DNS proxy | `dns.py` — forwards A-record queries to host resolver via `asyncio.getaddrinfo` |
| TCP NAT | `tcp_nat.py` — full RFC 793 state machine: SYN_RCVD → ESTABLISHED → CLOSE_WAIT/FIN_WAIT_1/2 → LAST_ACK, MSS option negotiation, modular sequence-number arithmetic, `asyncio.open_connection` for the host side |
| UDP NAT | `udp_nat.py` — per-(chip_port, dst, dst_port) `DatagramTransport`, idle reaper |

The bridge is fully self-contained — **zero subprocess overhead**, no
QEMU, no libslirp dependency. It runs in the same FastAPI event loop
the rest of the backend already uses.

## Test coverage

| Layer | Suite | Status |
|---|---|---|
| Bit decoder | `test/test_Raspberry_Pi_Pico_W/test_code/tests/01_pio_decoder.test.ts` | ✅ 9/9 |
| Bus handshake | `…/02_handshake.test.ts` | ✅ 6/6 |
| SDPCM codec | `…/04_sdpcm.test.ts` | ✅ 7/7 |
| IOCTL responses | `…/05_ioctl.test.ts` | ✅ 5/5 |
| Full lifecycle | `…/06_full_lifecycle.test.ts` | ✅ 3/3 |
| Real 100-days projects | `…/07_picow_iot_projects.test.ts` | ✅ 10/10 |
| Performance budgets | `…/08_viability.test.ts` | ✅ 9/9 |
| Frontend integration | `frontend/src/__tests__/picow-cyw43-integration.test.ts` | ✅ 6/6 |
| Backend bridge | `test/backend/integration/test_picow_net_bridge.py` | ✅ 18/18 |
| **Total** | — | **73 passed, 0 failed** |

The backend integration suite includes a **real TCP round-trip**: the
test stands up an in-process HTTP server, drives a SYN through the
bridge, walks through the full RFC 793 handshake, sends a `GET
/hello` request, asserts the response carries `HTTP/1.1 200 OK` and
`hello`, then closes cleanly. Likewise UDP (echo server) and DNS
(localhost resolution) are exercised end-to-end against real sockets.

End-to-end with real MicroPython firmware is gated on a UF2 fixture
that CI does not bundle (see `…/03_pico_w_blink.test.ts`); drop a
`fixtures/RPI_PICO_W-*.uf2` to enable.

## What's intentionally NOT supported

- **Bluetooth.** The CYW43439 also does BT 5.2; Velxio doesn't model
  it (Wokwi doesn't either). Calls into `bluetooth.BLE()` will raise.
- **ESP-NOW / raw 802.11.** Slirp only forwards TCP/UDP. A virtual
  802.11 hub like `mac80211_hwsim` would be needed to bridge two
  emulated boards at the MAC layer.
- **WPA2/WPA3 verification.** Any password "works" against the
  synthetic AP — same trade-off as Wokwi.
- **Bit-perfect timing.** The chip is modelled by behaviour, not by
  cycle-accurate firmware execution. Real-world `time.sleep_us()`-ish
  guarantees aren't enforced.

## See also

- `docs/wiki/picow-cyw43-emulation.md` — implementation post-mortem,
  what was tried, what was discarded, what's next.
- `docs/ESP32_WIFI_BLUETOOTH.md` — the ESP32 path that this mirrors.
- `test/test_Raspberry_Pi_Pico_W/autosearch/` — the upstream research
  dossier (8 markdown files) with citations and the layered design.
- Reference upstream: <https://github.com/KritishMohapatra/100_Days_100_IoT_Projects>
- Reference driver: <https://github.com/jbentham/picowi> (MIT, cloned at `third-party/picowi/`)
- Reference SPI program: <https://github.com/raspberrypi/pico-sdk/tree/master/src/rp2_common/pico_cyw43_driver>
