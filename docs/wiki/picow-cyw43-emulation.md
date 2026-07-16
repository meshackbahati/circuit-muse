# Pico W (CYW43439) Wi-Fi emulation — what we built and how

> **Status:** Full stack shipped 2026-04-29.
> Frontend chip emulator + backend pure-Python network stack (TCP/UDP
> NAT + ARP + DHCP + DNS + ICMP). No QEMU subprocess, no libslirp
> binding, no closed firmware blob.
> **All 73 tests pass** end-to-end including a real TCP round-trip
> against an in-process HTTP server.

This wiki entry is the post-mortem for how Velxio gained Wi-Fi on the
Raspberry Pi Pico W. The *user-facing* docs live at
[docs/PICO_W_WIFI_EMULATION.md](../PICO_W_WIFI_EMULATION.md). This
page is for the next maintainer who picks the work up.

## What we knew going in

`rp2040js` — Velxio's RP2040 emulator — had **zero** Wi-Fi support.
The single relevant upstream issue, [wokwi/rp2040js#134](https://github.com/wokwi/rp2040js/issues/134)
("Is there a way to emulate cyw43 using nodejs?"), was **open and
unanswered for years**. No community fork, no design draft. Wokwi's
own Pico W simulation was closed-source and lived server-side.

Every other CYW43 codebase we found pointed the *other* direction —
host-side drivers running on a real RP2040 talking to real silicon
([pico-sdk pico_cyw43_driver](https://github.com/raspberrypi/pico-sdk/tree/master/src/rp2_common/pico_cyw43_driver),
[embassy-rs/cyw43](https://github.com/embassy-rs/embassy/tree/main/cyw43),
[soypat/cyw43439](https://github.com/soypat/cyw43439),
[jbentham/picowi](https://iosoft.blog/picowi/)).
Useful for understanding *what the host writes*, useless for *what the
chip should answer*.

## What we did

We **stubbed the chip on the bus**, not in silicon. The driver gets
exactly what it expects byte-for-byte; the firmware blob never runs;
the radio MAC never executes. Three insights made this work in days
rather than quarters:

### Insight 1 — the gSPI protocol is fully documented

The 32-bit command word (`write/inc/func2/addr17/len11`), the function
numbers (F0=bus, F1=backplane, F2=radio data), the magic
`0xFEEDBEAD` test register, the SDPCM framing — all in Infineon's
public datasheet and re-implemented identically in three
permissively-licensed open drivers.

### Insight 2 — the firmware blob doesn't have to be loaded

The driver writes 224 KB of firmware into the chip's RAM at boot, but
**never reads any of it back**. After the stream it polls
`SDIO_CHIP_CLOCK_CSR` for the `HT_AVAIL` bit, asks for the MAC via
`cur_etheraddr`, and proceeds. The emulator can:

- Discard firmware writes (just track the auto-increment cursor so
  length math is right).
- Lie about `HT_AVAIL` going high.
- Hand back a synthetic MAC.

This sidesteps the licensing question entirely (Infineon's blob is
restricted to "use with CYW43xxx silicon products" — a JS emulator
isn't silicon). It also sidesteps the engineering nightmare of
emulating the Cortex-R4 and 802.11 radio inside the chip package.

### Insight 3 — the Velxio architecture already had the seam

`RP2040Simulator.ts` was already monkey-patching `rp2040js`'s
`pio.run` for unrelated reasons. A second hook on `txFIFO.push` —
the call site every PIO state machine uses to publish words on the
wire — gives us byte-level visibility into the gSPI bus without
modifying `rp2040js`.

## The shape that emerged

```
gSPI word (PIO TX FIFO)
    ↓ PioBusSniffer
32-bit command + payload
    ↓ Cyw43Emulator.onCommand()
F0/F1 register read/write OR SDPCM frame
    ↓ (if F2)
SDPCM frame
    ↓ decodeSdpcm()
control / event / data channel
    ↓ (control)
CDC IOCTL (cmd, payload)
    ↓ handleIoctl()
synthesised reply + queued events
    ↓ encodeSdpcm() / encodeEventFrame()
chip → host RX FIFO
    ↓ rp2040js PIO 'pull' instruction
back to the host driver
```

The same pattern accommodates `WLC_SET_VAR gpioout` (the on-board LED
IOCTL — fires `onLed` listener), `WLC_SCAN` (synthesises a single
`WLC_E_ESCAN_RESULT` event for `Velxio-GUEST` then `WLC_E_SCAN_COMPLETE`),
and `WLC_SET_SSID` (drives the documented event sequence
`JOIN_START → AUTH → ASSOC_START → ASSOC → SET_SSID → LINK(reason=1)`).

## Verification — what we actually tested

Eight test files. 55 tests. All green.

```
tests/01_pio_decoder.test.ts          (9 tests)   ← bit decoder
tests/02_handshake.test.ts            (6 tests)   ← Tier-0 handshake
tests/03_pico_w_blink.test.ts         (1 skip)    ← e2e w/ real UF2
tests/04_sdpcm.test.ts                (7 tests)   ← SDPCM/CDC codec
tests/05_ioctl.test.ts                (5 tests)   ← IOCTL surface
tests/06_full_lifecycle.test.ts       (3 tests)   ← bus→scan→connect→packet→disconnect
tests/07_picow_iot_projects.test.ts   (10 tests)  ← real 100-days projects
tests/08_viability.test.ts            (9 tests)   ← perf + IOCTL coverage budgets

frontend/src/__tests__/picow-cyw43-integration.test.ts  (6 tests)
```

The viability suite measures the chip-side throughput at
**~138 000 frames/s** for 1500-byte payloads. The chip can run inside
a single 60 fps frame and consume <0.05% of the budget.

The `07_picow_iot_projects.test.ts` suite drives the emulator with
the **exact** workflows of every Pico W project in
`third-party/100_Days_100_IoT_Projects/`:

- HTTP server with on-board LED toggle (Pico_W_Async_LED_Control)
- HTTP server flipping a relay (IoT_Relay_Control_Web_Server)
- `urequests.post` with JSON body (Pico_2_W_Dht11_Http_Csv_Logger)
- MQTT CONNECT/PUBLISH (Raspberry_Pi_Pico_2_W_ThingsBoard_IoT)
- WebSocket upgrade + masked frames (WebSocket_LED_Control)
- Servo over HTTP (Pico_W_Web_Servo_Controller)
- Bare GPIO without WiFi (PIR_Motion_Detector, Servo_Motor_Control)
- LED-only OTA (OTA_Update_Pico2W)
- `wlan.scan()` semantics

Each test asserts the chip emits the events it should and the bridge
sees the frames it should.

## What we deliberately did NOT do

| Out of scope | Why |
|---|---|
| Run the closed firmware blob | Would need a Cortex-R4 emulator + virtual radio. Same result as the stub. |
| Ship the firmware blob | Infineon license restricts redistribution to CYW43xxx silicon; an emulator isn't silicon. |
| Bluetooth | Wokwi doesn't either. None of the 100-days projects use it. |
| ESP-NOW / raw 802.11 between two Pico Ws | Would need a virtual MAC layer hub. Slirp only carries TCP/UDP. |
| WPA2/WPA3 verification | Local sim, no real WiFi spectrum — passwords are accepted as-is. |
| Bit-perfect timing | Behavioural model, not cycle-accurate. Real-world `time.sleep_us()` quirks may differ. |
| Backend slirp TCP/UDP fan-out | Scoped for follow-up PR — chip-side contract is done; the network half is mechanical. |

## Files of interest, in load order

1. `frontend/src/simulation/cyw43/constants.ts` — every numeric constant, BSD/MIT-derived.
2. `frontend/src/simulation/cyw43/sdpcm.ts` — framing codec.
3. `frontend/src/simulation/cyw43/virtual-ap.ts` — `Velxio-GUEST` single source of truth.
4. `frontend/src/simulation/cyw43/PioBusSniffer.ts` — 32-bit command decoder.
5. `frontend/src/simulation/cyw43/Cyw43Emulator.ts` — chip-side state machine (~470 LOC).
6. `frontend/src/simulation/cyw43/Cyw43Bridge.ts` — WS bridge twin of `Esp32Bridge`.
7. `frontend/src/simulation/RP2040Simulator.ts` — `attachCyw43()` plumbing.
8. `frontend/src/store/useSimulatorStore.ts` — auto-detect and lifecycle.
9. `backend/app/services/picow_net_bridge.py` — backend network manager.
10. `backend/app/api/routes/simulation.py` — `start_picow` / `stop_picow` / `picow_packet_out`.

## Things that bit us along the way

- **Pyright vs underscore-prefixed unused params.** Pyright still
  warns on `_inst`/`_ether` even though that's the standard
  Python convention. We left the warnings as `★` (info) since the
  function signatures are part of the public bridge contract.
- **Strict TS `Uint8Array<ArrayBuffer>` vs `Uint8Array<ArrayBufferLike>`.**
  TS 5.7 tightened these. The fix was to widen the IOCTL response
  variable's type explicitly (`Uint8Array<ArrayBufferLike>`).
- **Mocking `WebSocket` in vitest.** A simple `vi.fn()` for the
  constructor isn't enough — the bridge checks `WebSocket.OPEN`
  statically, so the fake class needs `static OPEN = 1`.
- **PIO halfword swap.** The `cyw43_bus_pio_spi.pio` program swaps
  16-bit halves before pushing words on the wire. Our sniffer has to
  un-swap before decoding. This was the single longest debug session.

## The backend network stack — why pure Python?

Two routes existed: spawn QEMU just for libslirp, or write the stack
ourselves. We picked option 4 from the conversation — pure Python —
because:

- A QEMU subprocess sized for "just slirp" still costs ~30 MB RSS per
  simulated chip. With many tabs that adds up.
- libslirp doesn't have stable Python bindings.
- The protocols are stable and well-documented. RFC 793 (TCP) is from
  1981; RFC 2131 (DHCP) is from 1997. We're not chasing a moving target.
- Pure-Python keeps the test surface honest — every test exercises real
  bytes through a real state machine, not "QEMU said it worked".

The whole stack landed in **~1300 LOC across 8 files**:

```
backend/app/services/picow_net/
├── consts.py           ~50 LOC   network parameters
├── checksums.py        ~30 LOC   RFC 1071 + pseudo-header
├── protocols.py       ~400 LOC   parsers + encoders for L2..L7
├── arp.py              ~50 LOC
├── dhcp.py            ~140 LOC
├── dns.py             ~150 LOC
├── icmp.py             ~30 LOC
├── tcp_nat.py         ~300 LOC   RFC 793 state machine
├── udp_nat.py         ~150 LOC
└── bridge.py          ~150 LOC   orchestrator
```

Every numeric constant traces back to a public RFC or datasheet —
nothing copied from `cyw43-driver` (RP-noncommercial). Worst quirk
during implementation: TCP sequence-number wrap-around. RFC 1323's
modular comparison (the `_seq_lt` helper in `tcp_nat.py`) is the
correct way; naive subtraction breaks at 2³² roll-over.

## What's left for someone else to take next

The path of least resistance:

1. **WS reconnect/backoff** — `Cyw43Bridge` doesn't retry on close.
   Mirror `Esp32Bridge` if/when users hit it.
2. **Window scaling (RFC 1323)** — current TCP NAT advertises a fixed
   65535 window. For high-bandwidth use cases (firmware OTA, streaming
   sensor logs) we'd want window scaling.
3. **TCP retransmit timer** — we don't time out unacked data; we
   trust the chip to retransmit. Real slirp does both.
4. **Bluetooth** — only worth it if a user files an issue. No 100-days
   project uses BT.
5. **TCP server-mode (chip listens, host connects)** — currently the
   chip is always the active opener. To accept inbound connections
   from the host we'd need a hostfwd-style port-forward layer like
   QEMU's `hostfwd=`.

If an upstream rp2040js maintainer ever responds to issue #134, this
work is small and modular enough to extract into a separate
`rp2040js-cyw43` package.
