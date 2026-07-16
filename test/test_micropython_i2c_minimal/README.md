# test_micropython_i2c_minimal

Phase 1 reproduction test for the MicroPython + I2C reboot bug on ESP32 QEMU.

## Why this exists

The example `100d-esp32-oled-smart-ui-eyes-animation-time-and-weather-micropython`
reboots the ESP32 silently when MicroPython touches `machine.I2C(0, ...)`.
Arduino C++ + `Wire.h` works on the same OLED. Hypothesis (see
`velxio-prod/project/phase-06-esp32-micropython-i2c-fix.md`): the picsimlab
QEMU emulation never raises the `tx_done` IRQ that the ESP-IDF i2c_master
driver waits on → MicroPython hangs → watchdog timeout → soft reset.

This test runs the **smallest possible** MicroPython program that hits the
hardware I2C peripheral, with NO ssd1306 driver and NO helper libraries,
so we can confirm the bug is at the QEMU / firmware boundary (not in the
OLED driver or the example's code).

## What it does

1. Downloads MicroPython v1.20.0 firmware (same one the velxio frontend ships).
2. Builds a 4 MB flash image with the firmware at offset 0x1000.
3. Opens a WebSocket to `BACKEND/api/simulation/ws/<session>`.
4. Sends `start_esp32` with the firmware + a registered SSD1306 slave at 0x3C.
5. Once the REPL prompt appears, injects the minimal program via raw-REPL + Ctrl+D:
   ```python
   from machine import Pin, I2C
   print("velxio_i2c_pre")
   i2c = I2C(0, scl=Pin(22), sda=Pin(21))
   print("velxio_i2c_ctor_ok")
   devs = i2c.scan()
   print("velxio_i2c_scan_ok", devs)
   try:
       i2c.writeto(0x3C, b"\xA0")
       print("velxio_i2c_write_ok")
   except OSError as e:
       print("velxio_i2c_write_err", e)
   print("velxio_i2c_done")
   ```
6. Watches the serial output + system events. Reports the LAST marker
   reached (`pre`, `ctor_ok`, `scan_ok`, `write_ok`/`write_err`, `done`)
   to localize exactly which I2C call triggers the reboot.

## Expected outcomes

| Before the fix | After the fix |
|---|---|
| Markers stop at `ctor_ok` or `scan_ok` | All 4 markers + `done` reached |
| `system: {event: reboot}` event arrives | No reboot event |
| WebSocket closes with code 1006 within ~5s of running | Test completes cleanly |

## How to run

Backend must be running at `http://localhost:8001` (default) — on the prod
server with `docker compose up -d`.

```bash
cd /home/dave/velxio-prod/velxio
node test/test_micropython_i2c_minimal/test.mjs
```

Optional flags:
- `--timeout=60` (default 60s)
- `--backend=http://localhost:8001`

Exit code 0 = full success (all markers + done). Non-zero = reboot or
incomplete. The report block at the end summarizes which marker was the
LAST one reached, which localizes the bug.

## Related files

- `velxio/test/backend/e2e/test_micropython_esp32.mjs` — the upstream
  template this is based on (boots MicroPython + injects a sanity check;
  doesn't touch I2C).
- `velxio/backend/app/services/esp32_worker.py` — `_on_i2c_event`
  callback (line ~928) that QEMU invokes per I2C event.
- `velxio/backend/app/services/esp32_i2c_slaves.py` — `I2CWriteSink`
  (line ~309) is what the SSD1306 slave registration uses.
- `velxio-prod/project/phase-06-esp32-micropython-i2c-fix.md` — phase
  tracking + plan.
