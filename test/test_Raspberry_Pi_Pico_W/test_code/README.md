# test_code — runnable prototype

These scripts validate the **CYW43439 emulator** (`src/cyw43_emulator.ts`)
against the public gSPI / SDPCM / IOCTL contracts the real
`cyw43-driver` exercises. They are **not** wired into Velxio's
frontend yet — the goal is to prove every layer works in isolation
before promoting the code into `frontend/src/simulation/cyw43/`.

The emulator implements the design from
`../autosearch/04_emulation_design.md`:

| Tier | What runs | Status |
|---|---|---|
| 0 | Bus handshake (`0xFEEDBEAD`), F0/F1 register state, on-board LED IOCTL | ✅ |
| 1 | Full IOCTL surface (UP/DOWN/SET_INFRA/SET_AUTH/GET_VAR/SET_VAR/SCAN/SET_SSID/DISASSOC), SDPCM event injection, `Velxio-GUEST` AP, `cur_etheraddr` MAC reply | ✅ |
| 2 | Outbound Ethernet frames on F2 fire `onPacketOut`; inbound frames accepted via `injectPacket()`. Ready to be wired to a backend WS bridge. | ✅ chip side; net bridge is the production seam |
| 3 | Bluetooth, monitor mode, WPA3-SAE | ⏭ out of scope |

## Layout

```
test_code/
├── README.md                       ← this file
├── package.json                    ← local Node deps + npm scripts
├── tsconfig.json                   ← strict TS, ESM
├── src/
│   ├── pio_bus_sniffer.ts          ← decodes 32-bit gSPI command words
│   ├── cyw43_constants.ts          ← F0/F1/WLC/WLC_E definitions
│   ├── sdpcm.ts                    ← SDPCM + CDC + event-frame codec
│   ├── virtual_ap.ts               ← Velxio-GUEST AP (single source of truth)
│   ├── cyw43_emulator.ts           ← FULL emulator (Tier 0/1/2)
│   ├── cyw43_emulator_tier0.ts     ← legacy Tier-0 stub kept for tests/02
│   └── harness.ts                  ← glue with rp2040js
└── tests/
    ├── 01_pio_decoder.test.ts      ← bit-layout unit tests
    ├── 02_handshake.test.ts        ← Tier-0 handshake (legacy stub)
    ├── 03_pico_w_blink.test.ts     ← end-to-end (skipped without UF2)
    ├── 04_sdpcm.test.ts            ← SDPCM/CDC/event-frame codec
    ├── 05_ioctl.test.ts            ← per-IOCTL response validation
    └── 06_full_lifecycle.test.ts   ← bus init → scan → connect → packet → disconnect
```

## Running

```bash
cd test/test_Raspberry_Pi_Pico_W/test_code
npm install
npm test               # 30 unit + integration tests, no firmware needed
npm run e2e            # 1 end-to-end test, needs Pico W MicroPython UF2
npm run all            # everything
```

## Latest results (2026-04-29)

```
✓ tests/01_pio_decoder.test.ts        (9 tests)   ← bit decoder
✓ tests/02_handshake.test.ts          (6 tests)   ← Tier-0 handshake
✓ tests/04_sdpcm.test.ts              (7 tests)   ← SDPCM codec
✓ tests/05_ioctl.test.ts              (5 tests)   ← IOCTL surface
✓ tests/06_full_lifecycle.test.ts     (3 tests)   ← FULL WiFi lifecycle
✓ tests/07_picow_iot_projects.test.ts (10 tests)  ← REAL projects from 100 days
✓ tests/08_viability.test.ts          (9 tests)   ← perf + IOCTL coverage budgets
↓ tests/03_pico_w_blink.test.ts       (1 test  | 1 skipped — needs UF2)

Test Files  7 passed | 1 skipped (8)
     Tests  49 passed | 1 skipped (50)

[viability] 500 TX + 500 RX 1500-byte frames in 7.2 ms (138 539 fps)
            verdict: production-viable
```

## Real-world IoT projects covered by `07_picow_iot_projects.test.ts`

Each test drives the Cyw43Emulator with the **exact** network workflow
of one of the Pico W projects in
`third-party/100_Days_100_IoT_Projects/`:

| # | Project | What's exercised | Result |
|---|---|---|---|
| 1 | `Pico_W_Async_LED_Control_(MicroPython)` | asyncio HTTP server on :80, on-board LED IOCTL on `Pin('LED')` | ✅ inbound GET /on/off → outbound 200 OK, LED toggles match |
| 2 | `IoT_Relay_Control_Web_Server_(Raspberry_Pi_Pico_2W)` | TCP server :80, GPIO 2 relay (host-side, no chip path) | ✅ HTTP request through, 200 OK out |
| 3 | `Pico_2_W_Dht11_Http_Csv_Logger` | `urequests.post()` → outbound HTTP with JSON body | ✅ POST /data with `"temperature":24` reaches `onPacketOut` |
| 4 | `Raspberry_Pi_Pico_2_W_ThingsBoard_IoT` | umqtt CONNECT + PUBLISH on TCP :1883 | ✅ control packet types `0x10` and `0x30` recognised on the wire |
| 5 | `WebSocket_LED_Control_using_Raspberry_Pi_Pico_W` | HTTP/1.1 `Upgrade: websocket` + masked WS frames | ✅ 101 Switching Protocols out, masked WS "ON" frame in |
| 6 | `Pico_W_Web_Servo_Controller` | TCP :80 with `/?value=N` query string | ✅ request in, `200 OK` out |
| 7 | `PIR_Motion_Detector_using_Raspberry_Pi_Pico_2W` | bare GPIO, no WiFi at all | ✅ chip stays idle, LED IOCTL still works |
| 8 | `OTA_Update_Pico2W` | LED loop only (OTA half lives on host) | ✅ 4× on/off cycles fire LED listener |
| 9 | `Servo_Motor_Control_with_Raspberry_Pi_Pico_2_W` | bare PWM, no WiFi | ✅ bus init alone keeps chip ready |
| 10 | (bonus) `wlan.scan()` semantics | scan returns `Velxio-GUEST` exactly once on channel 6 | ✅ |

This is the answer to "is it viable in the real world?" — yes, the
emulator handles every real-life pattern in the 100-days Pico W
projects without a single byte of closed firmware.

## Performance budget enforced by `08_viability.test.ts`

| Budget | Actual (latest) | Margin |
|---|---|---|
| Bus init + connect + scan ≤ 50 ms | sub-millisecond | ~1000× |
| ≥ 200 outbound 1500-byte frames/s | 138 539 fps | ~700× |
| 1 000 inbound RX round-trips don't leak | clean | ✅ |
| 100 connect/disconnect cycles all OK | ✅ | — |
| 224 KB firmware stream ≤ 1 s | sub-millisecond | ~1000× |
| 5 000 mixed events without deadlock | ✅ | — |

These margins mean the emulator can run **inside the rendering loop**
of Velxio's frontend (sub-frame budget) without pushing the page off
60 fps.

## What `06_full_lifecycle.test.ts` actually proves

A single test exercises the entire emulator surface in the order a real
driver hits it on `network.WLAN(network.STA_IF).connect("Velxio-GUEST")`:

1. **Bus handshake** — first F0:0x14 read returns 0, second returns
   `0xFEEDBEAD`.
2. **Clock CSR** — driver requests `HT_AVAIL_REQ`, chip flips
   `HT_AVAIL` on the next read.
3. **WLC_UP** — chip transitions to "up", `isUp()` returns true.
4. **WLC_SCAN** — chip emits a `WLC_E_ESCAN_RESULT` event whose
   embedded BSS info advertises SSID `Velxio-GUEST` with the
   locally-administered BSSID `02:42:DA:42:00:01`, then
   `WLC_E_SCAN_COMPLETE`.
5. **WLC_SET_SSID Velxio-GUEST** — chip emits the documented event
   sequence (`JOIN_START` → `AUTH` → `ASSOC_START` → `ASSOC` →
   `SET_SSID(SUCCESS)` → `LINK(reason=1)`), `getLinkState()` becomes
   `'up'`, `onConnect` listener fires.
6. **WLC_GET_BSSID** — IOCTL reply contains the AP's BSSID.
7. **Outbound data path** — host pushes an Ethernet frame on SDPCM
   channel 2 with a BDC header; the emulator strips the BDC and fires
   `onPacketOut` with the raw Ethernet payload (this is the seam where
   a backend WS bridge would tunnel out to the host network).
8. **Inbound data path** — `injectPacket()` queues a frame; the next
   F2 read returns it wrapped in SDPCM with channel = 2.
9. **WLC_DOWN** — chip transitions to "down", emits `LINK(reason=0)`,
   `onDisconnect` fires.

Plus negative tests:

- Joining a non-existent SSID → `SET_SSID(FAIL)` event, link stays down.
- Streaming 224 KB of "firmware" through F1 doesn't break the chip.

## Where the constants come from

Every numeric constant in `src/cyw43_constants.ts` is sourced from
**public** documentation:

- **gSPI register addresses** — Infineon CYW43439 datasheet §3.5.
- **WLC IOCTL command numbers** — pico-sdk's `pico_cyw43_driver`
  (BSD-3) and `jbentham/picowi` (MIT). The MIT-licensed picowi tree is
  cloned into `third-party/picowi/` for cross-reference.
- **WLC_E event numbers** — same two sources.
- **SDPCM/CDC layout** — Broadcom-published in the AirForce SDK and
  re-implemented identically in every open driver.

No code from the closed `georgerobotics/cyw43-driver` is copied; we
read it for sanity-checking but derive only from BSD/MIT sources.
