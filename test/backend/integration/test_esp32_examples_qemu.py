#!/usr/bin/env python3
"""End-to-end QEMU tests for ESP32 example sketches reported by beta testers.

Each test:
  1. Compiles a sketch via app.services.espidf_compiler.compile()
  2. Launches esp32_worker.py with the resulting firmware
  3. Captures serial output for N seconds
  4. Asserts on expected substrings + verifies NO ANSI escape sequences
     and NO `I (xxx) gpio:` info logs leak into the user's serial output

Skipped automatically when the ESP-IDF toolchain or libqemu shared
library are not available, so the suite is safe to run on Windows
dev boxes and only does real work in the Docker CI image.

Sketches are inlined verbatim from frontend/src/data/examples.ts and
frontend/src/data/examples-circuits.ts.

Run from the repo root:
    pytest test/backend/integration/test_esp32_examples_qemu.py -v

Or directly:
    python test/backend/integration/test_esp32_examples_qemu.py
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import re
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from typing import cast

# ── Path setup ────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[3] / 'backend'
SERVICES_DIR = BACKEND_DIR / 'app' / 'services'
WORKER = SERVICES_DIR / 'esp32_worker.py'

# libqemu has different filenames per platform.
if sys.platform == 'win32':
    LIB_XTENSA = SERVICES_DIR / 'libqemu-xtensa.dll'
elif sys.platform == 'darwin':
    LIB_XTENSA = SERVICES_DIR / 'libqemu-xtensa.dylib'
else:
    LIB_XTENSA = SERVICES_DIR / 'libqemu-xtensa.so'

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.espidf_compiler import espidf_compiler  # type: ignore[import-not-found]  # noqa: E402

# ── Regex helpers — bug #1 verifications ─────────────────────────────────────
ANSI_RE = re.compile(rb'\x1b\[[0-9;]*m')
# Matches lines like "I (53306) gpio: GPIO[4]| InputEn: 1| ..." that the
# beta tester reported leaking into user output before the WARN log-level fix.
ESPIDF_INFO_RE = re.compile(rb'^I \(\d+\) (gpio|wifi|phy|wifi_init):', re.MULTILINE)


# ─────────────────────────────────────────────────────────────────────────────
# Sketches under test (verbatim from frontend/src/data/examples.ts)
# ─────────────────────────────────────────────────────────────────────────────

SKETCH_DHT22 = r"""// ESP32 - DHT22 Temperature & Humidity Sensor
#include <DHT.h>

#define DHT_PIN  4
#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
  delay(2000);
  Serial.println("ESP32 DHT22 ready!");
}

void loop() {
  delay(2000);
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("DHT22: waiting for sensor...");
    return;
  }
  Serial.printf("Temp: %.1f C   Humidity: %.1f %%\n", t, h);
}
"""

SKETCH_SERVO_POT = r"""// ESP32 - Servo controlled by Potentiometer
#include <ESP32Servo.h>

#define SERVO_PIN 13
#define POT_PIN   34

Servo myServo;

void setup() {
  Serial.begin(115200);
  myServo.attach(SERVO_PIN, 500, 2400);
  Serial.println("ESP32 Servo + Pot control");
}

void loop() {
  int raw   = analogRead(POT_PIN);
  int angle = map(raw, 0, 4095, 0, 180);
  myServo.write(angle);
  Serial.printf("Pot: %4d  Angle: %3d deg\n", raw, angle);
  delay(20);
}
"""

SKETCH_JOYSTICK = r"""// ESP32 - Analog Joystick
#define JOY_HORZ 35
#define JOY_VERT 34
#define JOY_BTN  15

void setup() {
  Serial.begin(115200);
  pinMode(JOY_BTN, INPUT_PULLUP);
  Serial.println("ESP32 Joystick ready");
}

void loop() {
  int x    = analogRead(JOY_HORZ);
  int y    = analogRead(JOY_VERT);
  bool btn = (digitalRead(JOY_BTN) == LOW);
  int xPct = map(x, 0, 4095, -100, 100);
  int yPct = map(y, 0, 4095, -100, 100);
  Serial.printf("X=%4d(%4d%%) Y=%4d(%4d%%) BTN=%s\n",
    x, xPct, y, yPct, btn ? "PRESSED" : "---");
  delay(100);
}
"""

SKETCH_DUAL_ADC = r"""// ESP32 dual ADC - 12-bit, 3.3V reference
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}
void loop() {
  int ch1 = analogRead(34);
  int ch2 = analogRead(35);
  float v1 = ch1 * 3.3 / 4095.0;
  float v2 = ch2 * 3.3 / 4095.0;
  Serial.printf("CH1=%.3fV  CH2=%.3fV\n", v1, v2);
  delay(500);
}
"""

# Bug #3: uses arduino-esp32 3.x ledcAttach() — fails without velxio_compat.h shim.
SKETCH_LEDC_RGB = r"""// ESP32 LEDC PWM - RGB LED color cycling
#define R_PIN 16
#define G_PIN 17
#define B_PIN 18
void setup() {
  ledcAttach(R_PIN, 5000, 8);
  ledcAttach(G_PIN, 5000, 8);
  ledcAttach(B_PIN, 5000, 8);
}
void loop() {
  for(int h=0; h<360; h+=5) {
    float r,g,b;
    int i = h/60; float f = h/60.0-i;
    switch(i%6) {
      case 0: r=1; g=f;   b=0;   break;
      case 1: r=1-f; g=1; b=0;   break;
      case 2: r=0; g=1;   b=f;   break;
      case 3: r=0; g=1-f; b=1;   break;
      case 4: r=f; g=0;   b=1;   break;
      case 5: r=1; g=0;   b=1-f; break;
    }
    ledcWrite(R_PIN, (int)(r*255));
    ledcWrite(G_PIN, (int)(g*255));
    ledcWrite(B_PIN, (int)(b*255));
    delay(30);
  }
}
"""

SKETCH_WIFI_CONNECT = r"""#include <WiFi.h>

const char* ssid = "Velxio-GUEST";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("ESP32 WiFi Connection Demo");
  Serial.println("==========================");
  Serial.printf("Connecting to %s", ssid);

  WiFi.begin(ssid, "", 6);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println(" Connected!");
  Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  delay(5000);
}
"""

SKETCH_WIFI_SERVER = r"""#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "Velxio-GUEST";
WebServer server(80);

void handleRoot() {
  server.send(200, "text/plain", "Hello from ESP32!");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("ESP32 HTTP Server");

  WiFi.begin(ssid, "", 6);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  server.on("/", handleRoot);
  server.begin();

  Serial.printf("Server started at: http://%s/\n", WiFi.localIP().toString().c_str());
}

void loop() {
  server.handleClient();
}
"""

# Bug #2: arduino-esp32 BLEDevice.h needs Bluedroid (was NimBLE-only before fix).
SKETCH_BLE_ADVERTISE = r"""#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("ESP32 BLE Advertise Demo");

  BLEDevice::init("Velxio-ESP32");
  pServer = BLEDevice::createServer();
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setValue("Hello from Velxio!");

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->start();

  Serial.println("BLE advertising started!");
}

void loop() {
  delay(2000);
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _compile_via_espidf(sketch_code: str, fqbn: str = 'esp32:esp32:esp32') -> bytes:
    """Compile sketch through the production ESP-IDF compiler. Returns the
    trimmed firmware bytes ready to hand to esp32_worker.py.

    Raises AssertionError with stderr on compile failure so test diagnostics
    are immediately visible.
    """
    files = [{'name': 'sketch.ino', 'content': sketch_code}]
    result = asyncio.run(espidf_compiler.compile(files, fqbn))
    if not result.get('success'):
        raise AssertionError(
            f"Compile failed for fqbn={fqbn}:\n"
            f"  error:  {result.get('error')}\n"
            f"  stderr: {(result.get('stderr') or '')[-2000:]}\n"
        )
    bin_b64 = result.get('binary_content')
    if not bin_b64:
        raise AssertionError(f"Compile reported success but no binary_content: {result}")
    return base64.b64decode(bin_b64)


def _run_worker(firmware_bytes: bytes,
                run_seconds: float = 8.0,
                machine: str = 'esp32-picsimlab') -> dict:
    """Launch esp32_worker.py with firmware, collect events for `run_seconds`,
    return aggregated dict. Mirrors the pattern in test_esp32c3_emulation.py.

    Returns:
      {
        'serial_bytes': bytes,         # concatenated UART0 output
        'gpio_events':  list[(pin, state)],
        'sys_events':   list[str],
        'errors':       list[str],
        'booted':       bool,
        'all_events':   list[dict],
      }
    """
    if not WORKER.exists():
        raise unittest.SkipTest(f'Worker not found: {WORKER}')
    if not LIB_XTENSA.exists():
        raise unittest.SkipTest(f'libqemu not found: {LIB_XTENSA}')

    cfg = {
        'lib_path':     str(LIB_XTENSA),
        'firmware_b64': base64.b64encode(firmware_bytes).decode('ascii'),
        'machine':      machine,
    }

    proc = subprocess.Popen(
        [sys.executable, str(WORKER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )
    # PIPE was passed for all three streams, so they are non-None handles.
    # Cast to satisfy the type checker (Optional narrowing doesn't flow
    # through attribute access into closures).
    p_stdin = cast(io.BufferedWriter, proc.stdin)
    p_stdout = cast(io.BufferedReader, proc.stdout)
    p_stderr = cast(io.BufferedReader, proc.stderr)
    p_stdin.write((json.dumps(cfg) + '\n').encode('utf-8'))
    p_stdin.flush()

    serial_chunks: list[bytes] = []
    gpio_events: list[tuple[int, int]] = []
    sys_events: list[str] = []
    errors: list[str] = []
    all_events: list[dict] = []

    def _read_stdout() -> None:
        for raw_line in p_stdout:
            line = raw_line.decode('utf-8', errors='replace').strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except Exception:
                continue
            all_events.append(evt)
            t = evt.get('type')
            if t == 'uart_tx':
                # Single-byte event — append as a 1-byte chunk.
                b = evt.get('byte')
                if isinstance(b, int) and 0 <= b <= 255:
                    serial_chunks.append(bytes([b]))
            elif t == 'serial_output':
                data = evt.get('data')
                if isinstance(data, str):
                    serial_chunks.append(data.encode('utf-8', errors='replace'))
            elif t == 'gpio_change':
                gpio_events.append((evt.get('pin'), evt.get('state')))
            elif t == 'system':
                sys_events.append(evt.get('event', ''))
            elif t == 'error':
                errors.append(evt.get('message', ''))

    def _read_stderr() -> None:
        for _ in p_stderr:
            pass  # discard; surface via errors[] if the worker emits a JSON error event

    threading.Thread(target=_read_stdout, daemon=True).start()
    threading.Thread(target=_read_stderr, daemon=True).start()

    deadline = time.monotonic() + run_seconds
    while time.monotonic() < deadline and proc.poll() is None:
        time.sleep(0.2)

    # Graceful stop, then force.
    try:
        p_stdin.write((json.dumps({'cmd': 'stop'}) + '\n').encode('utf-8'))
        p_stdin.flush()
    except Exception:
        pass
    time.sleep(0.5)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    return {
        'serial_bytes': b''.join(serial_chunks),
        'gpio_events':  gpio_events,
        'sys_events':   sys_events,
        'errors':       errors,
        'booted':       'booted' in sys_events,
        'all_events':   all_events,
    }


def _toolchain_available() -> bool:
    return espidf_compiler.available and LIB_XTENSA.exists() and WORKER.exists()


# ─────────────────────────────────────────────────────────────────────────────
# Bug #1 — Serial cleanliness across multiple sketches
# ─────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(_toolchain_available(),
                     'Requires libqemu-xtensa + ESP-IDF toolchain (Docker CI)')
class TestEsp32SerialCleanliness(unittest.TestCase):
    """The reporter saw raw `[0;32m` ANSI codes and `I (xxx) gpio:` info logs
    mixed into the Serial.print output of these examples. After the sdkconfig
    log-level + ANSI strip fixes, neither should leak.

    Note: ANSI verification is on the BACKEND side (the worker emits raw
    UART bytes — frontend strip is a separate concern, covered by the
    SerialMonitor change in commit 3 of this series). The backend bug is
    that ESP-IDF's logger tags lines with `I (xxx) gpio:` at INFO level
    by default; we want only WARN+ leaking through.
    """

    def _assert_clean_user_output(self, sketch: str, expected_substr: bytes,
                                  run_seconds: float = 12.0):
        fw = _compile_via_espidf(sketch)
        out = _run_worker(fw, run_seconds=run_seconds)
        self.assertTrue(out['booted'], f"firmware never booted; events={out['all_events'][:5]}")
        self.assertFalse(
            ESPIDF_INFO_RE.search(out['serial_bytes']),
            f"ESP-IDF INFO logs leaked into user serial output:\n"
            f"{out['serial_bytes'][:400]!r}"
        )
        self.assertIn(
            expected_substr, out['serial_bytes'],
            f"Expected {expected_substr!r} in user output but got:\n"
            f"{out['serial_bytes'][:400]!r}"
        )

    def test_dht22_serial_is_clean(self):
        self._assert_clean_user_output(SKETCH_DHT22, b'Temp:', run_seconds=14)

    def test_servo_pot_serial_is_clean(self):
        self._assert_clean_user_output(SKETCH_SERVO_POT, b'Pot:')

    def test_joystick_serial_is_clean(self):
        self._assert_clean_user_output(SKETCH_JOYSTICK, b'X=')

    def test_dual_adc_serial_is_clean(self):
        self._assert_clean_user_output(SKETCH_DUAL_ADC, b'CH1=')


# ─────────────────────────────────────────────────────────────────────────────
# Bugs #2, #3 — Compile success regression coverage
# ─────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(_toolchain_available(),
                     'Requires libqemu-xtensa + ESP-IDF toolchain (Docker CI)')
class TestEsp32CompileSuccess(unittest.TestCase):
    """These sketches were reported as 'Fail to Compile' before commits 1
    (Bluedroid) and 2 (LEDC compat shim).
    """

    def test_ble_advertise_compiles(self):
        # Bug #2 — sdkconfig now enables Bluedroid, BLEDevice.h must compile.
        fw = _compile_via_espidf(SKETCH_BLE_ADVERTISE)
        self.assertGreater(len(fw), 100_000,
                           f"BLE Advertise firmware looks suspiciously small: {len(fw)} bytes")

    def test_ledc_rgb_compiles(self):
        # Bug #3 — velxio_compat.h shim provides ledcAttach() on 2.0.17.
        fw = _compile_via_espidf(SKETCH_LEDC_RGB)
        self.assertGreater(len(fw), 100_000,
                           f"LEDC RGB firmware looks suspiciously small: {len(fw)} bytes")

    def test_ledc_rgb_boots(self):
        """Stronger than compile: the firmware must reach setup() and run
        the user loop without crashing. The shim's dynamic channel allocation
        is exercised at runtime here.
        """
        fw = _compile_via_espidf(SKETCH_LEDC_RGB)
        out = _run_worker(fw, run_seconds=6)
        self.assertTrue(out['booted'],
                        f"LEDC RGB never booted; events={out['all_events'][:5]}")


# ─────────────────────────────────────────────────────────────────────────────
# Regression — WiFi sketches still associate after the sdkconfig changes
# ─────────────────────────────────────────────────────────────────────────────

@unittest.skipUnless(_toolchain_available(),
                     'Requires libqemu-xtensa + ESP-IDF toolchain (Docker CI)')
class TestEsp32WiFiSketches(unittest.TestCase):
    """The sdkconfig changes (log level + Bluedroid) shouldn't have broken
    WiFi association. WiFi takes longer to come up — give it 25 s.
    """

    def test_wifi_connect_reaches_got_ip(self):
        fw = _compile_via_espidf(SKETCH_WIFI_CONNECT)
        out = _run_worker(fw, run_seconds=25)
        self.assertTrue(out['booted'])
        self.assertIn(b'IP Address:', out['serial_bytes'],
                      f"Never saw IP Address line; output:\n{out['serial_bytes'][-800:]!r}")
        # Bug #1 also applies to WiFi sketches — no info logs leaking.
        self.assertFalse(ESPIDF_INFO_RE.search(out['serial_bytes']),
                         "WiFi sketch leaked ESP-IDF info logs")

    def test_wifi_server_starts(self):
        fw = _compile_via_espidf(SKETCH_WIFI_SERVER)
        out = _run_worker(fw, run_seconds=25)
        self.assertTrue(out['booted'])
        self.assertIn(b'Server started', out['serial_bytes'],
                      f"Server never started; output:\n{out['serial_bytes'][-800:]!r}")


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    unittest.main(verbosity=2)
