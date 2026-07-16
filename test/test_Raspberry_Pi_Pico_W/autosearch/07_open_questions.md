# Open questions that research alone can't answer

These need a decision from David / the Velxio core team before code
lands. Putting them here so they're not lost.

## 1. Tier 2 transport — slirp port vs backend bridge

Two options for "WiFi packets actually leave the simulator":

- **In-frontend slirp** (libslirp.js / userland TCP/IP) — the WASM
  bundle grows by ~400 KB and HTTPS goes through the browser's CORS
  rules, which kills most cloud APIs from the 100-days suite (Blynk,
  ThingSpeak, Telegram).
- **Backend WS bridge** — identical pattern to `esp32_worker.py`. Adds
  a Python file, no bundle bloat, no CORS, but requires the backend
  to be running for Pico W WiFi to work.

The ESP32 path takes option B today. **Recommendation:** mirror it for
consistency. The user's expectation that "ESP32 WiFi works" already
means a backend is running.

## 2. Where the new code lives

Three plausible homes:

- `frontend/src/simulation/cyw43/` — sibling of `MicroPythonLoader.ts`
  and `RP2040Simulator.ts`. Most consistent with current layout.
- A new `third-party/cyw43js/` clone, mirroring how avr8js / rp2040js
  are vendored. Sets us up to **upstream the work back to Wokwi as a
  separate package** later, which is a real possibility (issue #134
  has been open with no maintainer comment for years — they may be
  receptive to a contribution).
- Inside `third-party/rp2040js/` directly — fastest to integrate,
  worst for long-term sync with upstream.

**Recommendation:** start in `frontend/src/simulation/cyw43/` for Tier 0
and 1. Decide on extraction once the API is stable.

## 3. Do we need the second core?

The Pico W MicroPython firmware uses Core 1 for the cyw43 driver task.
`rp2040js` today emulates **only Core 0** (per `RP2040Simulator.ts`
comment "single-core emulated"). MicroPython's Pico W port works on a
single core too, but **the locking is core-aware** and a few code paths
(`cyw43_arch_lwip_check`) take spin locks targeting the other core.

This is a Tier 1 problem, not Tier 0. Tier 0 LED control runs entirely
on Core 0. We can defer.

## 4. Visual representation in Velxio

Pico W and plain Pico render identically today. Suggestion: when
`languageMode === 'micropython'` AND `boardKind === 'pi-pico-w'`,
render a small antenna icon next to the board to visually communicate
"WiFi is alive on this board". Trivial CSS work, not a blocker.

## 5. What to do with the ten 100-days projects right now

Until Tier 0 lands, they import successfully (static-analysis tests
pass) but hang at `wlan.connect()`. Three options:

- **Ship as-is** — broken at runtime, working in the editor. Confusing.
- **Demote them in the gallery** — add a `requiresUnsupportedFeature: 'wifi'`
  flag to ExampleProject, and surface a "Pico W WiFi not yet emulated"
  banner when one of these is loaded.
- **Demote them in test_100_days** — move them to NOT_SUPPORTED until
  Tier 1 lands.

**Recommendation:** option 2 — keep them visible and discoverable, mark
them clearly. When Tier 1 ships, the marker disappears.

## 6. Bluetooth?

The CYW43439 is dual-radio (WiFi + BT 5.2). MicroPython on Pico W
exposes BT via `bluetooth.BLE()`. None of the 100-days Pico W projects
use it. Not in scope. If a user files an issue, point them at the
Wokwi Pico W BT scope (also not implemented there as of last check).

## 7. RP2350 / Pico 2 W

The Pico 2 W exists, uses the same CYW43439, talks the same gSPI.
Whatever we build for Pico W works for Pico 2 W with **only** the
core-emulation change (RP2350 = ARMv8-M, not in `rp2040js` upstream
but in c1570's fork). Out of scope for now but design accordingly:
the CYW43 emulator should not assume `rp2040` specifically — it
should attach to "any RPxxxx with a PIO peripheral".
