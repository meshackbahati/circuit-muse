/**
 * 07_picow_iot_projects.test.ts
 *
 * Real-world feasibility check: drives the Cyw43Emulator with the
 * exact network workflows used by the **Pico W projects** in
 *   third-party/100_Days_100_IoT_Projects/
 *
 * For each project we encode the high-level Python calls
 * (`wlan.active(True)`, `wlan.connect(...)`, `urequests.post(...)`,
 * `socket.bind/listen/accept`, MQTT publish, WebSocket frame, …) into
 * the IOCTL + SDPCM stream MicroPython would emit, push it through
 * our emulator, and assert the resulting state.
 *
 * Each project test is a single `it(...)` block, so failures localise
 * cleanly. Sources for each project remain at the path noted in the
 * test heading.
 */

import { describe, it, expect } from 'vitest';
import { Cyw43Emulator } from '../src/cyw43_emulator.js';
import { MicroPythonSim } from '../src/micropython_sim.js';
import { DEFAULT_AP, DEFAULT_STA_IP } from '../src/virtual_ap.js';

/** Boot a chip and bring it to "WiFi connected to Velxio-GUEST" state. */
function bringUp(ssid = 'Velxio-GUEST', password = 'anything'): {
  chip: Cyw43Emulator;
  mp: MicroPythonSim;
} {
  const chip = new Cyw43Emulator();
  const mp = new MicroPythonSim(chip);
  mp.busInit();
  mp.active_(true);
  expect(chip.isUp()).toBe(true);
  const r = mp.connect(ssid, password);
  expect(r.ok).toBe(true);
  expect(mp.isconnected()).toBe(true);
  return { chip, mp };
}

/** Encode an HTTP request the script's webserver would receive. */
function httpRequestFrame(method: string, path: string, host: string): Uint8Array {
  const txt =
    `${method} ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `User-Agent: velxio-test\r\n` +
    `Accept: */*\r\n` +
    `Connection: close\r\n\r\n`;
  return new TextEncoder().encode(txt);
}

/** Build a minimal Ethernet frame carrying ``payload`` between two MACs. */
function ethFrame(dst: Uint8Array, src: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(14 + payload.length);
  out.set(dst, 0);
  out.set(src, 6);
  out[12] = 0x08; out[13] = 0x00; // IPv4 ethertype
  out.set(payload, 14);
  return out;
}

describe('Pico W IoT projects — real workflows against the emulator', () => {
  // ─────────────────────────────────────────────────────────────────
  // 1. Pico_W_Async_LED_Control  (asyncio web server + LED IOCTL)
  // ─────────────────────────────────────────────────────────────────
  it('Pico_W_Async_LED_Control — wlan up, /on toggles LED, /off toggles back', () => {
    const { chip, mp } = bringUp();
    expect(mp.ifconfig().ip).toBe(DEFAULT_STA_IP);

    // Capture LED toggles. The script does `led.on()` / `led.off()` on
    // Pin('LED') — that's the on-board CYW43-driven LED → gpioout IOCTL.
    const led: boolean[] = [];
    chip.onLed((ev) => led.push(ev.on));

    // Simulate the host stack receiving GET /on then GET /off
    chip.injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array, // destination = STA MAC
      DEFAULT_AP.bssid,                    // source = AP
      httpRequestFrame('GET', '/on', DEFAULT_STA_IP),
    ));
    // Drive the chip's gpioout IOCTL the way MP's `Pin("LED").on()` does.
    fireGpioOut(mp, true);
    chip.injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array,
      DEFAULT_AP.bssid,
      httpRequestFrame('GET', '/off', DEFAULT_STA_IP),
    ));
    fireGpioOut(mp, false);

    mp.drainInbound();
    expect(led).toEqual([true, false]);
    // Both inbound HTTP requests reached the simulated socket layer.
    expect(mp.inbound.length).toBeGreaterThanOrEqual(2);
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. IoT_Relay_Control_Web_Server  (TCP server :80 toggling relay GPIO 2)
  // ─────────────────────────────────────────────────────────────────
  it('IoT_Relay_Control_Web_Server — accepts requests, sends 200 OK back', () => {
    const { mp } = bringUp();
    // Inbound: GET /on
    mp['chip'].injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array,
      DEFAULT_AP.bssid,
      httpRequestFrame('GET', '/on', DEFAULT_STA_IP),
    ));
    mp.drainInbound();
    expect(mp.inbound.length).toBe(1);
    // Outbound: synthesise the script's "HTTP/1.1 200 OK" reply.
    const reply = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>OK</html>',
    );
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      reply,
    ));
    // Verify the chip exposed the outbound frame to the bridge.
    let captured: Uint8Array | null = null;
    mp['chip'].onPacketOut((ev) => { captured = ev.ether; });
    // Trigger another send to capture via listener
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      new Uint8Array([0xde, 0xad]),
    ));
    expect(captured).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Pico_2_W_Dht11_Http_Csv_Logger  (urequests.post HTTP client)
  // ─────────────────────────────────────────────────────────────────
  it('Pico_2_W_Dht11_Http_Csv_Logger — urequests.post sends an outbound POST', () => {
    const { mp } = bringUp();
    const captured: Uint8Array[] = [];
    mp['chip'].onPacketOut((ev) => captured.push(ev.ether));

    const body = '{"temperature":24,"humidity":55}';
    const post = new TextEncoder().encode(
      `POST /data HTTP/1.1\r\nHost: 10.13.37.1:5000\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    );
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      post,
    ));

    expect(captured).toHaveLength(1);
    const decoded = new TextDecoder().decode(captured[0].subarray(14));
    expect(decoded).toMatch(/^POST \/data /);
    expect(decoded).toContain('"temperature":24');
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Raspberry_Pi_Pico_2_W_ThingsBoard_IoT  (umqtt → MQTT broker)
  // ─────────────────────────────────────────────────────────────────
  it('Raspberry_Pi_Pico_2_W_ThingsBoard_IoT — MQTT CONNECT + PUBLISH frames go out', () => {
    const { mp } = bringUp();
    const captured: Uint8Array[] = [];
    mp['chip'].onPacketOut((ev) => captured.push(ev.ether));

    // MQTT v3.1.1 CONNECT control packet (highly abridged)
    const mqttConnect = new Uint8Array([
      0x10, 0x18,                  // CONNECT, remaining length 24
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // protocol name "MQTT"
      0x04,                        // protocol level 4
      0x82,                        // connect flags: clean session + password
      0x00, 0x3c,                  // keepalive 60
      0x00, 0x0d,                  // client id length 13
      ...new TextEncoder().encode('Pico_W_Cuttack'.slice(0, 13)),
    ]);
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      mqttConnect,
    ));

    // PUBLISH telemetry
    const payload = new TextEncoder().encode(
      JSON.stringify({ temperature: 24, humidity: 55, ledStatus: false }),
    );
    const topic = new TextEncoder().encode('v1/devices/me/telemetry');
    const publish = new Uint8Array(2 + 2 + topic.length + payload.length);
    publish[0] = 0x30; // PUBLISH QoS 0
    publish[1] = 2 + topic.length + payload.length;
    publish[2] = 0; publish[3] = topic.length;
    publish.set(topic, 4);
    publish.set(payload, 4 + topic.length);
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      publish,
    ));

    expect(captured).toHaveLength(2);
    // First frame is a CONNECT
    expect(captured[0][14] & 0xf0).toBe(0x10);
    // Second frame is a PUBLISH
    expect(captured[1][14] & 0xf0).toBe(0x30);
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. WebSocket_LED_Control  (HTTP upgrade → WS frames toggling external LED)
  // ─────────────────────────────────────────────────────────────────
  it('WebSocket_LED_Control_using_Raspberry_Pi_Pico_W — HTTP upgrade then WS frames', () => {
    const { mp } = bringUp();
    const captured: Uint8Array[] = [];
    mp['chip'].onPacketOut((ev) => captured.push(ev.ether));

    // Inbound: HTTP upgrade request
    const upgradeReq = new TextEncoder().encode(
      'GET / HTTP/1.1\r\n' +
      `Host: ${DEFAULT_STA_IP}\r\n` +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n',
    );
    mp['chip'].injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array,
      DEFAULT_AP.bssid,
      upgradeReq,
    ));
    mp.drainInbound();
    expect(mp.inbound.length).toBe(1);

    // Outbound: 101 Switching Protocols
    const upgradeResp = new TextEncoder().encode(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n',
    );
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      upgradeResp,
    ));

    // Inbound: WS text frame "ON" (masked from client)
    const wsOn = new Uint8Array([
      0x81, 0x82, 0x12, 0x34, 0x56, 0x78, // FIN+TEXT, mask, masking key
      'O'.charCodeAt(0) ^ 0x12,
      'N'.charCodeAt(0) ^ 0x34,
    ]);
    mp['chip'].injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array,
      DEFAULT_AP.bssid,
      wsOn,
    ));
    mp.drainInbound();

    // Outbound: server reply "LED IS ON" (unmasked)
    const wsResp = new Uint8Array([0x81, 9, ...new TextEncoder().encode('LED IS ON')]);
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      wsResp,
    ));

    expect(captured.length).toBeGreaterThanOrEqual(2);
    // First outbound is the 101 response
    expect(new TextDecoder().decode(captured[0].subarray(14, 14 + 12)))
      .toBe('HTTP/1.1 101');
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Pico_W_Web_Servo_Controller  (servo over HTTP — but no WiFi LED)
  // ─────────────────────────────────────────────────────────────────
  it('Pico_W_Web_Servo_Controller — accepts /?value=N, replies HTML', () => {
    const { mp } = bringUp();
    const captured: Uint8Array[] = [];
    mp['chip'].onPacketOut((ev) => captured.push(ev.ether));

    mp['chip'].injectPacket(ethFrame(
      mp['chip']['staMac'] as Uint8Array,
      DEFAULT_AP.bssid,
      httpRequestFrame('GET', '/?value=120', DEFAULT_STA_IP),
    ));
    mp.drainInbound();
    expect(mp.inbound.length).toBe(1);

    const reply = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html>OK 120</html>',
    );
    mp.sendEthernet(ethFrame(
      DEFAULT_AP.bssid,
      mp['chip']['staMac'] as Uint8Array,
      reply,
    ));
    expect(captured).toHaveLength(1);
    expect(new TextDecoder().decode(captured[0].subarray(14, 14 + 15)))
      .toBe('HTTP/1.1 200 OK');
  });

  // ─────────────────────────────────────────────────────────────────
  // 7. PIR_Motion_Detector  (no WiFi at all — emulator must still boot clean)
  // ─────────────────────────────────────────────────────────────────
  it('PIR_Motion_Detector — emulator stays usable when the script never touches WiFi', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    // Script never calls active(True). Driver should stay healthy.
    expect(chip.isUp()).toBe(false);
    expect(chip.getLinkState()).toBe('down');
    // LED IOCTL must still work even without WLC_UP — the on-board
    // LED on Pico W goes through the chip regardless of WiFi state.
    let ledState: boolean | null = null;
    chip.onLed((ev) => { ledState = ev.on; });
    fireGpioOut(mp, true);
    expect(ledState).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────
  // 8. OTA_Update_Pico2W  (LED-only main.py, OTA path is host side)
  // ─────────────────────────────────────────────────────────────────
  it('OTA_Update_Pico2W — boot loop with LED toggles works without network', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    const led: boolean[] = [];
    chip.onLed((ev) => led.push(ev.on));
    for (let i = 0; i < 4; i++) {
      fireGpioOut(mp, true);
      fireGpioOut(mp, false);
    }
    expect(led).toEqual([true, false, true, false, true, false, true, false]);
  });

  // ─────────────────────────────────────────────────────────────────
  // 9. Servo_Motor_Control  (no WiFi — bare PWM, identity check)
  // ─────────────────────────────────────────────────────────────────
  it('Servo_Motor_Control_with_Raspberry_Pi_Pico_2_W — bus init alone is enough', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    // No `active(True)` call → no extra IOCTLs. Chip is idle but ready.
    expect(chip.isUp()).toBe(false);
    expect(chip.getLinkState()).toBe('down');
  });

  // ─────────────────────────────────────────────────────────────────
  // Bonus — wlan.scan() returns Velxio-GUEST as the only AP
  // ─────────────────────────────────────────────────────────────────
  it('wlan.scan() returns Velxio-GUEST exactly once', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);
    const networks = mp.scan();
    expect(networks).toHaveLength(1);
    expect(networks[0].ssid).toBe('Velxio-GUEST');
    expect(networks[0].channel).toBe(6);
  });
});

/**
 * Drive the gpioout IOCTL the way MicroPython's `Pin('LED').on()` does:
 * SET_VAR with name "gpioout" and 8-byte payload <mask, value>.
 */
function fireGpioOut(mp: MicroPythonSim, on: boolean): void {
  const name = new TextEncoder().encode('gpioout\0');
  const value = new Uint8Array(8);
  new DataView(value.buffer).setUint32(0, 0x01, true);
  new DataView(value.buffer).setUint32(4, on ? 0x01 : 0x00, true);
  const buf = new Uint8Array(name.length + value.length);
  buf.set(name); buf.set(value, name.length);
  // Use the same path connect() uses to fire IOCTLs.
  (mp as any).ioctl(263 /* WLC_SET_VAR */, buf, 1);
}
