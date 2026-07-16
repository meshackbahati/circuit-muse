/**
 * Pico W WiFi showcase — curated examples that highlight Velxio's
 * new CYW43439 chip emulation (see frontend/src/simulation/cyw43/).
 *
 * Source projects come from
 *   https://github.com/KritishMohapatra/100_Days_100_IoT_Projects
 * (cloned at third-party/100_Days_100_IoT_Projects/) — every example
 * here is a verbatim copy of the upstream `Main Files/main.py` for the
 * matching project, with the WiFi credentials replaced by the synthetic
 * `Velxio-GUEST` AP that the emulator advertises.
 *
 * Each example is wired up to load with:
 *   boardType: 'pi-pico-w'           ← triggers Cyw43Bridge attachment
 *   languageMode: 'micropython'      ← MicroPythonLoader
 *   files: [{ name: 'main.py', ... }]
 *
 * The end-to-end harness that proves these work end-to-end lives at
 *   test/test_Raspberry_Pi_Pico_W/test_code/tests/07_picow_iot_projects.test.ts
 */

import type { ExampleProject } from './examples';

const TAGS_WIFI = ['100-days', 'pi-pico-w', 'micropython', 'wifi', 'cyw43'];

/** Replace placeholder SSID/password lines with our virtual AP. */
function withVelxioGuest(source: string): string {
  return source
    .replace(/SSID\s*=\s*"[^"]*"/g, 'SSID = "Velxio-GUEST"')
    .replace(/ssid\s*=\s*"[^"]*"/g, 'ssid = "Velxio-GUEST"')
    .replace(/WIFI_SSID\s*=\s*"[^"]*"/g, 'WIFI_SSID = "Velxio-GUEST"')
    .replace(/PASSWORD\s*=\s*"[^"]*"/g, 'PASSWORD = ""')
    .replace(/password\s*=\s*"[^"]*"/g, 'password = ""')
    .replace(/PASS\s*=\s*"[^"]*"/g, 'PASS = ""')
    .replace(/WIFI_PASSWORD\s*=\s*"[^"]*"/g, 'WIFI_PASSWORD = ""');
}

// ─── Project sources ─────────────────────────────────────────────────
//
// Pasted from upstream `Main Files/main.py`. Comments at the top of each
// string credit the original author/repo. Anyone can re-extract these by
// running `python test/test_100_days/_emit_examples_data.py`.

const ASYNC_LED_CONTROL_PY = withVelxioGuest(`# Pico W Async LED Control — MicroPython
# Source: github.com/KritishMohapatra/100_Days_100_IoT_Projects
# Project: Pico_W_Async_LED_Control_(MicroPython)
#
# Connects to Velxio-GUEST and runs a tiny async HTTP server on :80
# that toggles the on-board LED via Pin('LED'). The LED is wired
# through the CYW43439 chip — Velxio's new emulator picks up the
# gpioout IOCTL and drives the LED in the canvas.

import uasyncio as asyncio
import network
from machine import Pin

SSID = "Velxio-GUEST"
PASSWORD = ""

led = Pin("LED", Pin.OUT)
led.off()

async def wifi_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    print("Connecting WiFi...")
    while not wlan.isconnected():
        await asyncio.sleep(0.5)
    print("IP:", wlan.ifconfig()[0])

HTML = """<!DOCTYPE html>
<html><body><h2>Pico W Async LED</h2>
<button onclick="fetch('/on')">ON</button>
<button onclick="fetch('/off')">OFF</button>
</body></html>"""

async def handle_client(reader, writer):
    request_line = await reader.readline()
    request = request_line.decode()
    while await reader.readline() != b"\\r\\n":
        pass
    if "GET /on" in request:
        led.on(); body = "ON"
    elif "GET /off" in request:
        led.off(); body = "OFF"
    else:
        body = HTML
    writer.write(("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nConnection: close\\r\\n\\r\\n" + body).encode())
    await writer.drain()
    await writer.wait_closed()

async def main():
    await wifi_connect()
    await asyncio.start_server(handle_client, "0.0.0.0", 80)
    print("Server running on port 80")
    while True:
        await asyncio.sleep(1)

asyncio.run(main())
`);

const RELAY_WEB_SERVER_PY = withVelxioGuest(`# IoT Relay Control Web Server — MicroPython
# Source: github.com/KritishMohapatra/100_Days_100_IoT_Projects
# Project: IoT_Relay_Control_Web_Server_(Raspberry_Pi_Pico_2W)
#
# A blocking-style HTTP server on port 80 that flips a relay on
# GP2 in response to GET /on and GET /off. The server runs on the
# IP that Velxio's emulator hands out (10.13.37.42).

import network
import socket
import machine
import time

relay = machine.Pin(2, machine.Pin.OUT)
relay_state = 1
relay.value(relay_state)

ssid = "Velxio-GUEST"
password = ""

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(ssid, password)

print("Connecting...")
while not wlan.isconnected():
    time.sleep(0.5)

ip = wlan.ifconfig()[0]
print("Connected at:", ip)

s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((ip, 80))
s.listen(1)

print("Open browser: http://" + ip)

while True:
    conn, addr = s.accept()
    request = str(conn.recv(1024))
    if "/on" in request:
        relay_state = 0; relay.value(relay_state)
    elif "/off" in request:
        relay_state = 1; relay.value(relay_state)
    conn.send("HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n")
    conn.sendall("<html><body>Relay: %s</body></html>" %
                 ("ON" if relay_state == 0 else "OFF"))
    conn.close()
`);

const SERVO_WEB_PY = withVelxioGuest(`# Pico W Web Servo Controller — MicroPython
# Source: github.com/KritishMohapatra/100_Days_100_IoT_Projects
# Project: Pico_W_Web_Servo_Controller

import network
import socket
from machine import Pin, PWM
import time

ssid = "Velxio-GUEST"
password = ""

print("Connecting to WiFi...")
sta = network.WLAN(network.STA_IF)
sta.active(True)
sta.connect(ssid, password)
while not sta.isconnected():
    time.sleep(0.5)
print("Connected!", sta.ifconfig()[0])

servo = PWM(Pin(15), freq=50)

def write_servo(angle):
    angle = max(0, min(180, angle))
    pulse_us = 500 + (2500 - 500) * (angle / 180)
    duty = int((pulse_us / 20000) * 65535)
    servo.duty_u16(duty)

def webpage(pos):
    return ("<html><body><h1>Servo {p}&deg;</h1>"
            "<input type=range min=0 max=180 value={p} "
            "oninput=\\"fetch('/?value='+this.value)\\"></body></html>").format(p=pos)

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('', 80))
s.listen(5)

current_pos = 90
write_servo(current_pos)
print("Web server started on port 80")

while True:
    conn, addr = s.accept()
    request = conn.recv(1024).decode('utf-8')
    if "GET /?value=" in request:
        try:
            v = int(request.split("/?value=")[1].split(" ")[0])
            if 0 <= v <= 180:
                current_pos = v; write_servo(v)
        except (ValueError, IndexError):
            pass
    conn.send('HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n')
    conn.sendall(webpage(current_pos).encode('utf-8'))
    conn.close()
`);

const WS_LED_PY = withVelxioGuest(`# WebSocket LED Control — MicroPython
# Source: github.com/KritishMohapatra/100_Days_100_IoT_Projects
# Project: WebSocket_LED_Control_using_Raspberry_Pi_Pico_W

import socket, network, time, ubinascii, uhashlib
from machine import Pin

led = Pin(15, Pin.OUT); led.value(0)

SSID = "Velxio-GUEST"
PASSWORD = ""

def ws_accept(key):
    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    return ubinascii.b2a_base64(uhashlib.sha1((key + GUID).encode()).digest()).strip().decode()

def ws_decode(data):
    if len(data) < 6: return ""
    payload_len = data[1] & 127
    mask = data[2:6]
    payload = data[6:6 + payload_len]
    return bytes(payload[i] ^ mask[i % 4] for i in range(len(payload))).decode()

wlan = network.WLAN(network.STA_IF); wlan.active(True); wlan.connect(SSID, PASSWORD)
while not wlan.isconnected():
    time.sleep(1)
print("Connected!", wlan.ifconfig()[0])

server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", 80)); server.listen(1)

while True:
    conn, addr = server.accept()
    try:
        raw = conn.recv(1024).decode()
        if "Sec-WebSocket-Key" in raw:
            key = raw.split("Sec-WebSocket-Key: ")[1].split("\\r\\n")[0].strip()
            conn.send(("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\n"
                       "Connection: Upgrade\\r\\nSec-WebSocket-Accept: %s\\r\\n\\r\\n" % ws_accept(key)))
            while True:
                data = conn.recv(1024)
                if not data: break
                msg = ws_decode(data)
                if msg == "ON": led.value(1); reply = "LED IS ON"
                elif msg == "OFF": led.value(0); reply = "LED IS OFF"
                else: reply = "OK"
                conn.send(bytearray([0x81, len(reply)]) + reply.encode())
    finally:
        conn.close()
`);

// ─── Curated entries ─────────────────────────────────────────────────

export const picowWifiExamples: ExampleProject[] = [
  {
    id: 'picow-wifi-async-led',
    title: 'Pico W — Async LED control over Wi-Fi',
    description:
      'Pico W joins Velxio-GUEST then runs an async HTTP server on :80. /on and /off toggle the on-board LED through the CYW43 chip — the same path the real driver takes.',
    category: 'communication',
    difficulty: 'beginner',
    boardType: 'pi-pico-w',
    languageMode: 'micropython',
    files: [{ name: 'main.py', content: ASYNC_LED_CONTROL_PY }],
    code: '',
    components: [],
    wires: [],
    tags: TAGS_WIFI,
  },
  {
    id: 'picow-wifi-relay-web-server',
    title: 'Pico W — IoT relay web server',
    description:
      'Blocking HTTP server that drives a relay on GP2. Hit http://10.13.37.42/on and /off to flip it. Source: 100_Days_100_IoT_Projects/IoT_Relay_Control_Web_Server.',
    category: 'communication',
    difficulty: 'beginner',
    boardType: 'pi-pico-w',
    languageMode: 'micropython',
    files: [{ name: 'main.py', content: RELAY_WEB_SERVER_PY }],
    code: '',
    components: [],
    wires: [],
    tags: TAGS_WIFI.concat(['relay']),
  },
  {
    id: 'picow-wifi-servo-web',
    title: 'Pico W — Web servo controller',
    description:
      'Drives a servo on GP15 from a slider on a web page served by the Pico W. Source: 100_Days_100_IoT_Projects/Pico_W_Web_Servo_Controller.',
    category: 'robotics',
    difficulty: 'intermediate',
    boardType: 'pi-pico-w',
    languageMode: 'micropython',
    files: [{ name: 'main.py', content: SERVO_WEB_PY }],
    code: '',
    components: [],
    wires: [],
    tags: TAGS_WIFI.concat(['servo']),
  },
  {
    id: 'picow-wifi-websocket-led',
    title: 'Pico W — WebSocket-controlled LED',
    description:
      'Hand-rolled WebSocket server. Browser opens an upgrade request, then sends "ON"/"OFF" frames to toggle the LED on GP15. Source: 100_Days_100_IoT_Projects/WebSocket_LED_Control_using_Raspberry_Pi_Pico_W.',
    category: 'communication',
    difficulty: 'advanced',
    boardType: 'pi-pico-w',
    languageMode: 'micropython',
    files: [{ name: 'main.py', content: WS_LED_PY }],
    code: '',
    components: [],
    wires: [],
    tags: TAGS_WIFI.concat(['websocket']),
  },
];
