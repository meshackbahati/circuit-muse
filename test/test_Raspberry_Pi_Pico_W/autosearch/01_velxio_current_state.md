# Velxio's current Pico W state — what works, what doesn't

## Boards declared in the board catalogue

`frontend/src/types/board.ts` declares both:

```ts
'raspberry-pi-pico':  'rp2040:rp2040:rpipico',
'pi-pico-w':          'rp2040:rp2040:rpipicow',
```

Both compile fine through `arduino-cli` and run on the same emulator
(`rp2040js`). For Arduino sketches the toolchain is functional today —
GPIO blink, ADC, PWM, I²C, UART, SPI, USB CDC, the lot.

## Where the gap is

Velxio's RP2040 simulator wrapper (`frontend/src/simulation/RP2040Simulator.ts`)
imports straight from `rp2040js` and the upstream package contains zero
references to:

```
$ grep -rE "CYW43|cyw43|wifi|WLAN|802\.11" third-party/rp2040js/src
   (no matches)
```

The MicroPython loader for the Pico (`MicroPythonLoader.ts`) downloads
and flashes `RPI_PICO-20230426-v1.20.0.uf2` — the **non-W** firmware.
There is no `RPI_PICO_W` firmware in `public/firmware/` either, so
**the moment a user does `import network` the boot fails** with
`ImportError: no module named 'network'` (the non-W build doesn't ship
the network module).

For Arduino sketches the failure is louder — `WiFi.h` includes from
`arduino-pico` resolve symbols against `libpico_cyw43_driver`, the linker
succeeds against the closed firmware blob, and at runtime the driver
spins on the gSPI test register waiting for `0xFEEDBEAD` that never
arrives. Sketches that use `WiFi.begin()` hang at boot.

## How users hit this in the 100-days suite

Of the 49 supported MicroPython projects we just shipped to `/examples`,
**ten** target Pico W and use `network.WLAN`:

```
test/test_100_days/IoT_Relay_Control_Web_Server_Raspberry_Pi_Pico_2W/
test/test_100_days/OTA_Update_Pico2W/
test/test_100_days/PIR_Motion_Detector_using_Raspberry_Pi_Pico_2W_and_MicroPython/
test/test_100_days/Pico_2_W_Dht11_Http_Csv_Logger/
test/test_100_days/Pico_W_Async_LED_Control_MicroPython/
test/test_100_days/Pico_W_Web_Servo_Controller/
test/test_100_days/Raspberry_Pi_Pico_2_W_ThingsBoard_IoT/
test/test_100_days/Servo_Motor_Control_with_Raspberry_Pi_Pico_2_W_MicroPython/
test/test_100_days/Single_Digit_Seven_Segment_Display_with_Raspberry_Pi_Pico_MicroPython/
test/test_100_days/WebSocket_LED_Control_using_Raspberry_Pi_Pico_W/
```

These currently load into the editor (so static-analysis tests pass)
but won't actually boot to a Wi-Fi-connected state on Velxio.

## What the ESP32 path does that we'd need to mirror

`backend/app/services/esp32_worker.py` runs Espressif's QEMU build with:

```
-nic user,model=esp32_wifi,id=u1
```

QEMU has a built-in slirp user-mode networking stack and an ESP32-specific
NIC model that pretends to be the on-chip WiFi MAC. Guest firmware sees
a real radio, Velxio sees TCP/UDP traffic that slirp tunnels through the
host kernel. **No 802.11 frames cross the boundary** — slirp only carries
TCP/UDP, but that's fine for the projects users care about.

Pico W has nothing equivalent because:

1. `rp2040js` is in-process JavaScript, not QEMU. There is no
   `-nic user,model=cyw43_wifi`.
2. The CYW43439 sits behind a *bus* (gSPI over PIO), not a memory-mapped
   peripheral. We can't just register a register-block listener; we have
   to interpose at the PIO state-machine level.
3. The driver expects a 224 KB closed firmware blob to be loaded into
   the chip's RAM before any command works. We must either ship the blob,
   or convince the driver the load already happened.

The next file (`02_rp2040js_inventory.md`) catalogues the hooks
`rp2040js` does give us to work with.
