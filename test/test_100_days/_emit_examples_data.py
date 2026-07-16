"""
Reads every project in test/test_100_days/ that has a test (i.e. is
SUPPORTED — no NOT_SUPPORTED.md present) and emits a TypeScript module
``frontend/src/data/examples-100-days.ts`` containing one
``ExampleProject`` entry per project.

Each emitted entry uses the new MicroPython-aware fields:
  - languageMode: 'micropython'
  - files: [ { name, content }, ... ]      ← every .py file in source/
  - code: ''                                ← legacy field, unused for MP

Categories and difficulty are derived heuristically from the project name
and detected features (the same data we computed in _generate.py).

Run from repo root:
    python test/test_100_days/_emit_examples_data.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT     = Path(__file__).resolve().parents[2]
TESTS_ROOT    = REPO_ROOT / "test" / "test_100_days"
OUT_FILE      = REPO_ROOT / "frontend" / "src" / "data" / "examples-100-days.ts"
ORIG_PROJECTS = REPO_ROOT / "third-party" / "100_Days_100_IoT_Projects"

# ── Board mapping (test_100_days kind → ExampleProject.boardType) ──────────
BOARD_TO_TYPE = {
    "esp32":       "esp32",
    "esp32-s3":    "esp32",       # Velxio editor still labels these as esp32 in boardType
    "esp32-c3":    "esp32-c3",
    "xiao-esp32":  "esp32",
    "rp2040":      "raspberry-pi-pico",
    "pico-w":      "raspberry-pi-pico",
}

# ── Heuristic category / difficulty ───────────────────────────────────────
def derive_category(name: str, features: set[str]) -> str:
    n = name.lower()
    if {"i2c_oled", "max7219", "tm1637", "lcd"} & features:
        return "displays"
    if {"servo", "stepper"} & features or "robot" in n or "motor" in n:
        return "robotics"
    if {"wifi", "blynk", "telegram", "thingspeak", "mqtt", "websocket",
        "blynk_cloud", "ble", "http_server", "esp_now"} & features:
        return "communication"
    if {"dht", "rfid", "ldr", "ultrasonic", "rtc"} & features or "sensor" in n:
        return "sensors"
    return "basics"


def derive_difficulty(features: set[str]) -> str:
    if {"esp_now", "ota", "websocket", "ble", "blynk_cloud"} & features:
        return "advanced"
    if {"wifi", "thingspeak", "telegram", "mqtt", "rfid", "max7219",
        "i2c_oled", "lcd", "stepper"} & features:
        return "intermediate"
    return "beginner"


# Same regexes as _generate.py — kept in sync intentionally.
FEATURE_PATTERNS: dict[str, str] = {
    "wifi":         r"network\.WLAN|import\s+network\b|WiFi\.begin|connectWiFi|wlan\.connect",
    "blynk":        r"BlynkLib|blynk\.virtual_write|@blynk\.on|Blynk\.run",
    "telegram":     r"api\.telegram\.org|telegram_bot|sendMessage\?",
    "thingspeak":   r"thingspeak|api\.thingspeak\.com",
    "blynk_cloud":  r"blynk\.cloud|blynk\.io",
    "mqtt":         r"\bumqtt|MQTTClient|paho\.mqtt|mqtt\.publish|mqtt\.connect",
    "esp_now":      r"\bespnow\b|esp_now|ESPNow|ESP_NOW",
    "ble":          r"\bbluetooth\b|\bBLE\b|nimble|ubluetooth",
    "i2c_oled":     r"ssd1306|sh1106|SSD1306_I2C",
    "dht":          r"\bimport\s+dht\b|DHT11|DHT22|dht\.DHT",
    "rfid":         r"mfrc522|MFRC522",
    "max7219":      r"max7219|MAX7219",
    "tm1637":       r"\btm1637\b",
    "servo":        r"\bservo\b|PWM\(.*Pin",
    "stepper":      r"A4988|stepper",
    "ldr":          r"\bLDR\b|ldr\b",
    "ultrasonic":   r"hcsr04|HCSR04|trig\b.*echo\b",
    "lcd":          r"i2c_lcd|LCD_I2C|lcd_api",
    "rtc":          r"\burtc\b|DS1307|DS3231|rtc\.datetime",
    "ws2812":       r"neopixel|NeoPixel|ws2812",
    "ota":          r"\bota\b|OTA",
    "websocket":    r"\bwebsocket|uwebsockets|async_websocket_server",
    "http_server":  r"socket\.bind|socket\.listen|microdot|app\.route",
}

BOARD_PATTERNS = [
    (r"esp32[-_]?c3", "esp32-c3"),
    (r"esp32[-_]?s3", "esp32-s3"),
    (r"xiao[-_ ]?esp32", "xiao-esp32"),
    (r"esp8266", "esp8266"),
    (r"(?:^|[^a-z])pico[-_ ]?w(?:[^a-z]|$)|raspberry[-_ ]?pi[-_ ]?pico[-_ ]?(?:2[-_ ]?)?w",
     "pico-w"),
    (r"(?:^|[^a-z])pico(?:[^a-z]|$)|rp2040|raspberry[-_ ]?pi[-_ ]?pico", "rp2040"),
    (r"(?:^|[^a-z])esp32(?:[^a-z0-9]|$)", "esp32"),
]

def detect_board(name: str, src_blob: str) -> str | None:
    for pat, b in BOARD_PATTERNS:
        if re.search(pat, name, re.I) or re.search(pat, src_blob, re.I):
            return b
    if "machine" in src_blob:  # fallback for bare MicroPython
        return "esp32"
    return None


def detect_features(src_blob: str) -> set[str]:
    out: set[str] = set()
    for feat, pat in FEATURE_PATTERNS.items():
        if re.search(pat, src_blob, re.I):
            out.add(feat)
    return out


def humanize(name: str) -> str:
    """Turn 'IoT_Smart_Irrigation_System' → 'IoT Smart Irrigation System'."""
    s = name.replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def short_description(name: str, board: str, features: set[str]) -> str:
    hum = humanize(name)
    feat_list = sorted(features)
    cleaned_feats = []
    LABEL = {
        "wifi": "Wi-Fi", "blynk": "Blynk", "blynk_cloud": "Blynk Cloud",
        "telegram": "Telegram", "thingspeak": "ThingSpeak", "mqtt": "MQTT",
        "esp_now": "ESP-NOW", "ble": "BLE", "i2c_oled": "OLED",
        "dht": "DHT", "rfid": "RFID", "max7219": "MAX7219",
        "tm1637": "TM1637", "servo": "Servo", "stepper": "Stepper",
        "ldr": "LDR", "ultrasonic": "HC-SR04", "lcd": "I²C LCD",
        "rtc": "RTC", "ota": "OTA", "websocket": "WebSocket",
        "http_server": "HTTP server",
    }
    for f in feat_list:
        if f in LABEL:
            cleaned_feats.append(LABEL[f])
    feat_blurb = (" — uses " + ", ".join(cleaned_feats)) if cleaned_feats else ""
    board_label = {
        "esp32": "ESP32", "esp32-c3": "ESP32-C3",
        "raspberry-pi-pico": "Raspberry Pi Pico W",
    }.get(BOARD_TO_TYPE.get(board, ""), "")
    if board_label:
        return f"{hum} on {board_label} (MicroPython){feat_blurb}."
    return f"{hum} (MicroPython){feat_blurb}."


# ── TypeScript escaping ────────────────────────────────────────────────────

def ts_string_literal(s: str) -> str:
    """Emit a TypeScript template-string-safe literal — backtick-delimited."""
    # Escape backticks, backslashes, ${
    s = s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    return "`" + s + "`"


def js_id(s: str) -> str:
    """Stable, URL-friendly ID."""
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return f"100d-{s}" if s else "100d-untitled"


# ── Driver ────────────────────────────────────────────────────────────────

def collect_supported() -> list[dict]:
    out = []
    for entry in sorted(TESTS_ROOT.iterdir()):
        if not entry.is_dir():
            continue
        if (entry / "NOT_SUPPORTED.md").is_file():
            continue
        # Match against the upstream project name to get the original (with parens etc.)
        # by looking for the corresponding test file's docstring "Velxio emulation
        # test for: <name>"
        test_files = list(entry.glob("test_*.py"))
        if not test_files:
            continue
        upstream_name = entry.name  # safe name fallback
        try:
            head = test_files[0].read_text(encoding="utf-8")
            m = re.search(r"Velxio emulation test for: (.+)", head)
            if m:
                upstream_name = m.group(1).strip()
        except OSError:
            pass

        src_dir = entry / "source"
        if not src_dir.is_dir():
            continue
        py_files = sorted(src_dir.glob("*.py"))
        if not py_files:
            continue

        files = []
        full_blob = ""
        for f in py_files:
            try:
                content = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                content = f.read_bytes().decode("utf-8", errors="replace")
            files.append({"name": f.name, "content": content})
            full_blob += "\n" + content

        board = detect_board(upstream_name, full_blob) or "esp32"
        # Skip projects whose board can't be expressed in ExampleProject.boardType
        if board not in BOARD_TO_TYPE:
            continue
        features = detect_features(full_blob)

        out.append({
            "safe":        entry.name,
            "name":        upstream_name,
            "board_kind":  board,
            "board_type":  BOARD_TO_TYPE[board],
            "files":       files,
            "features":    sorted(features),
            "category":    derive_category(upstream_name, features),
            "difficulty":  derive_difficulty(features),
            "description": short_description(upstream_name, board, features),
        })
    return out


def emit_ts(entries: list[dict]) -> str:
    head = '''\
/**
 * 100 Days of IoT — example projects from
 * https://github.com/KritishMohapatra/100_Days_100_IoT_Projects
 *
 * AUTO-GENERATED by `test/test_100_days/_emit_examples_data.py`.
 * Do not edit by hand. Re-run the generator after pulling new upstream
 * projects:
 *
 *     python test/test_100_days/_emit_examples_data.py
 *
 * Only the projects Velxio can run end-to-end are emitted (49/78 at the
 * time of generation — see test/test_100_days/README.md for the full
 * compatibility matrix). Each example is a MicroPython project; the
 * editor switches into MicroPython mode automatically when one of these
 * is loaded (see utils/loadExample.ts).
 */

import type { ExampleProject } from './examples';

export const hundredDaysExamples: ExampleProject[] = [
'''
    body_parts = []
    for e in entries:
        files_lit = "[\n" + ",\n".join(
            "      { name: " + json.dumps(f["name"]) +
            ", content: " + ts_string_literal(f["content"]) + " }"
            for f in e["files"]
        ) + ",\n    ]"

        # Tags — what we feed the gallery search box.
        tags = sorted(set(e["features"] +
                          [e["board_kind"], e["board_type"], "micropython", "100-days"]))
        tags_lit = json.dumps(tags)

        body_parts.append(
            "  {\n"
            f"    id: {json.dumps(js_id(e['safe']))},\n"
            f"    title: {json.dumps(humanize(e['name']))},\n"
            f"    description: {json.dumps(e['description'])},\n"
            f"    category: {json.dumps(e['category'])},\n"
            f"    difficulty: {json.dumps(e['difficulty'])},\n"
            f"    boardType: {json.dumps(e['board_type'])},\n"
            f"    languageMode: 'micropython',\n"
            f"    files: {files_lit},\n"
            "    code: '',\n"
            "    components: [],\n"
            "    wires: [],\n"
            f"    tags: {tags_lit},\n"
            "  },"
        )
    return head + "\n".join(body_parts) + "\n];\n"


def main() -> None:
    entries = collect_supported()
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(emit_ts(entries), encoding="utf-8")
    print(f"wrote {len(entries)} examples -> {OUT_FILE.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
