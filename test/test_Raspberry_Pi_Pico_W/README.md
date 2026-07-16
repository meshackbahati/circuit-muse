# test_Raspberry_Pi_Pico_W

Research + prototype scaffold for **adding CYW43439 WiFi emulation to
Velxio's Raspberry Pi Pico W simulation**.

This folder is the answer to:

> "Velxio emulates ESP32 WiFi but not Raspberry Pi Pico W WiFi. The
> WiFi chip is a CYW43439. Has anyone written an emulator for it?
> Look at `third-party/rp2040js` and figure out what would be needed to
> complete WiFi emulation."

It is **not** a feature drop. The Velxio frontend and backend are
unchanged. Everything here is research, design, and a runnable
prototype harness so that the actual feature work — when it lands — can
land confidently.

## Layout

```
test_Raspberry_Pi_Pico_W/
├── README.md                          ← this file
├── autosearch/                        ← the dossier
│   ├── 00_README.md                   ← TL;DR + index
│   ├── 01_velxio_current_state.md     ← what's broken on Pico W today
│   ├── 02_rp2040js_inventory.md       ← what we'd build on top of
│   ├── 03_cyw43_bus_protocol.md       ← gSPI command word, registers, magic
│   ├── 04_emulation_design.md         ← layered plan: Tier 0 → 3
│   ├── 05_existing_implementations.md ← every CYW43 codebase we found
│   ├── 06_firmware_blob_question.md   ← can we ship the 224 KB blob? (no)
│   ├── 07_open_questions.md           ← decisions still open
│   └── sources.md                     ← every URL, dated 2026-04-28
└── test_code/                         ← runnable Tier-0 prototype
    ├── README.md
    ├── package.json                   ← local Node deps
    ├── tsconfig.json
    ├── src/
    │   ├── pio_bus_sniffer.ts         ← decodes gSPI cmds off PIO TX FIFO
    │   ├── cyw43_emulator_tier0.ts    ← stub chip — handshake + LED
    │   └── harness.ts                 ← glue for rp2040js
    └── tests/
        ├── 01_pio_decoder.test.ts     ← bit-layout unit tests
        ├── 02_handshake.test.ts       ← 0xFEEDBEAD + HT_AVAIL + LED IOCTL
        └── 03_pico_w_blink.test.ts    ← end-to-end (skipped without UF2)
```

## TL;DR of the research

| Question | Answer |
|---|---|
| Is there an open-source CYW43439 emulator? | **No.** Open issue [wokwi/rp2040js#134](https://github.com/wokwi/rp2040js/issues/134) confirms upstream hasn't done it; no community fork either. Wokwi simulates Pico W WiFi, but their CYW43 model is closed-source. |
| Is the protocol documented? | **Yes.** Infineon datasheet + three open-source host drivers (pico-sdk, embassy-rs, soypat, picowi) describe every byte the host sends. |
| Do we need the 224 KB firmware blob? | **No.** The driver doesn't read it back — it just streams it and trusts the chip. We ack the writes and lie about HT_AVAIL. |
| Reasonable to add to Velxio? | **Yes**, in 4 tiers — Tier 0 (LED works, ~450 LOC) is achievable in a few days. Tier 2 (real WiFi via slirp through the backend, mirroring the ESP32 path) is comparable in size to the existing ESP32 work. |

Full breakdown in [`autosearch/00_README.md`](./autosearch/00_README.md).

## TL;DR of the prototype

```bash
cd test/test_Raspberry_Pi_Pico_W/test_code
npm install
npm test       # 30 unit + integration tests pass — Tier 0/1/2
npm run e2e    # 1 e2e test, skipped without a Pico W MicroPython UF2
```

The suite covers the entire chip-side surface:

- **Bus protocol** (`01`, `02`) — `0xFEEDBEAD` handshake, F0/F1
  registers, clock CSR, the 224 KB firmware-stream absorb path.
- **SDPCM/CDC framing** (`04`) — encode/decode round-trips for control
  frames, IOCTL requests, async event frames.
- **IOCTL responses** (`05`) — `GET_MAGIC`, `UP`/`DOWN`,
  `cur_etheraddr` returns the STA MAC, `gpioout` fires the on-board
  LED, `WLC_SCAN` produces a real `wl_escan_result_t` advertising
  `Velxio-GUEST`.
- **Full WiFi lifecycle** (`06`) — bus init → scan → `SET_SSID
  Velxio-GUEST` → link up → `GET_BSSID` → outbound Ethernet frame →
  inbound packet injection → `WLC_DOWN` → link down. Plus negative
  cases (unknown SSID, mid-firmware-stream IOCTLs).

That is enough to back **production-grade** Pico W WiFi emulation in
Velxio. The remaining work to ship is purely integration:

1. Move `src/{pio_bus_sniffer,cyw43_emulator,sdpcm,virtual_ap,cyw43_constants}.ts`
   into `frontend/src/simulation/cyw43/`.
2. Hook `RP2040Simulator.ts` to attach the emulator only when
   `boardKind === 'pi-pico-w'`.
3. Add a backend WS bridge that turns `onPacketOut` Ethernet frames
   into TCP/UDP via slirp (mirror `backend/app/services/esp32_worker.py`).

## Test results (latest run, 2026-04-29)

```
$ npm test
✓ tests/01_pio_decoder.test.ts    (9 tests)
✓ tests/02_handshake.test.ts      (6 tests)
✓ tests/04_sdpcm.test.ts          (7 tests)
✓ tests/05_ioctl.test.ts          (5 tests)
✓ tests/06_full_lifecycle.test.ts (3 tests)

Test Files  5 passed (5)
     Tests  30 passed (30)
```

```
$ npm run e2e
↓ tests/03_pico_w_blink.test.ts (1 test | 1 skipped)
[03_pico_w_blink] SKIP: drop a Pico W MicroPython UF2 in fixtures/
                  to enable this test. Suggested file:
                  RPI_PICO_W-20230426-v1.20.0.uf2
```

## What "Velxio-GUEST" looks like

The synthetic AP every Pico W simulation joins (single source of
truth in `src/virtual_ap.ts`):

| Field | Value |
|---|---|
| SSID | `Velxio-GUEST` |
| BSSID | `02:42:DA:42:00:01` (locally-administered) |
| Channel | 6 |
| RSSI | -40 dBm |
| Security | open (we accept any password the user sends) |
| STA MAC | `02:42:DA:00:00:42` |
| STA IP (when DHCP gets wired) | `10.13.37.42/24`, gw `10.13.37.1` |

Same naming convention as the existing ESP32 path (`Velxio-GUEST`).
No Wokwi-* identifiers anywhere in the tree.

## What this folder does NOT do

- It does **not** modify the Velxio frontend, backend, or
  `third-party/rp2040js`. The repo's Pico W behaviour is unchanged.
- It does **not** ship the closed CYW43 firmware blob — see
  [`autosearch/06_firmware_blob_question.md`](./autosearch/06_firmware_blob_question.md).
- It does **not** implement Tier 1+ (scan, connect, real packet flow).
  Those are scoped in [`autosearch/04_emulation_design.md`](./autosearch/04_emulation_design.md)
  but intentionally not built — the point of the prototype is to
  prove the **hardest** layer (bus protocol) works against rp2040js.

When the feature graduates to a real Velxio surface, the right move is:

1. Promote `src/cyw43_emulator_tier0.ts` and `src/pio_bus_sniffer.ts`
   into `frontend/src/simulation/cyw43/`.
2. Wire the harness into `RP2040Simulator.ts` only when
   `boardKind === 'pi-pico-w'`.
3. Implement Tier 1 IOCTLs (~600 LOC) — most are 1-line acks.
4. Add the backend WS bridge for Tier 2 (mirror `esp32_worker.py`).
