/**
 * test_micropython_wifi_trace.mjs — Phase 7.1 reproduction + trace capture
 *
 * Drives the simulation backend WebSocket directly (bypasses the velxio
 * frontend's WiFi-stub prelude) and injects a minimal MicroPython
 * program that touches `network.WLAN(STA_IF)`. The QEMU build under
 * test has DEBUG=1 in hw/misc/esp32_wifi.c, esp32_phya.c, esp32_ana.c,
 * so every register read/write through those peripherals is fprintf'd
 * to the worker subprocess's stderr — which is piped to uvicorn and
 * shows up in `docker logs velxio-app` with the [esp32_worker] prefix.
 *
 * Expected outcome (pre-fix): chip hangs/reboots somewhere inside
 * network.WLAN(STA_IF), no `VLX_DONE` marker printed. Trace captures
 * the LAST register accesses before the hang — those are where the
 * emulation falls short.
 *
 * Run:
 *   docker logs velxio-app --since 1s > /tmp/before.log 2>&1
 *   node --experimental-websocket test/test_micropython_wifi_trace/test.mjs \
 *        --backend=http://localhost:3080 --timeout=60
 *   docker logs velxio-app 2>&1 | grep -E '\[(wifi|phya|ana )\]' > /tmp/wifi-trace.log
 */

const BACKEND   = process.env.BACKEND_URL
  ?? process.argv.find(a => a.startsWith('--backend='))?.slice(10)
  ?? 'http://localhost:3080';
const WS_BASE   = BACKEND.replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:');
const SESSION   = `test-mp-wifi-trace-${Date.now()}`;
const TIMEOUT_S = parseInt(
  process.argv.find(a => a.startsWith('--timeout='))?.slice(10) ?? '60'
);

const FIRMWARE_URL = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20230426-v1.20.0.bin';
const FLASH_OFFSET = 0x1000;
const FLASH_SIZE   = 4 * 1024 * 1024;

// Minimal program: import network + instantiate WLAN. That's it.
// network.WLAN(STA_IF) is where MP triggers esp_wifi_init internally —
// that's the call that hangs in unmodified picsimlab QEMU.
const INJECT_CODE = [
  'print("VLX_PRE")',
  'import network',
  'from time import sleep',
  'print("VLX_IMPORT_OK")',
  'w = network.WLAN(network.STA_IF)',
  'print("VLX_WLAN_OK")',
  'w.active(True)',
  'print("VLX_ACTIVE_OK")',
  'print("VLX_STATUS", w.status())',
  'print("VLX_CONFIG_MAC", w.config("mac"))',
  'w.connect("ssid", "pass")',
  'print("VLX_CONNECT_CALL_OK")',
  'for i in range(5):',
  '    print("VLX_LOOP", i, "isconn=", w.isconnected())',
  '    sleep(0.5)',
  'print("VLX_DONE")',
].join('\n');

const T0  = Date.now();
const ts  = () => `[+${((Date.now() - T0) / 1000).toFixed(3)}s]`;
const C   = {
  INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m',
  OK: '\x1b[32m', RESET: '\x1b[0m',
};
const log    = (lvl, ...a) => console.log(`${C[lvl] ?? ''}${ts()} [${lvl}]${C.RESET}`, ...a);
const info   = (...a) => log('INFO',   ...a);
const ok     = (...a) => log('OK',     ...a);
const warn   = (...a) => log('WARN',   ...a);
const err    = (...a) => log('ERROR',  ...a);

async function downloadFirmware() {
  info(`Downloading MicroPython firmware ...`);
  const res = await fetch(FIRMWARE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  ok(`Downloaded ${bytes.length} bytes`);
  return bytes;
}

function buildFlashImage(firmware) {
  const image = new Uint8Array(FLASH_SIZE).fill(0xFF);
  image.set(firmware, FLASH_OFFSET);
  return image;
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

function runSimulation(firmware_b64) {
  return new Promise((resolve) => {
    const wsUrl = `${WS_BASE}/api/simulation/ws/${SESSION}`;
    info(`Connecting WebSocket → ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    const result = {
      replReady: false,
      codeInjected: false,
      markers: new Set(),
      reboot: false,
      systemEvents: [],
      wsCloseCode: null,
      timedOut: false,
    };

    let replState = 'idle';
    let serialBuf = '';

    const globalTimer = setTimeout(() => {
      info(`Global timeout (${TIMEOUT_S}s)`);
      result.timedOut = true;
      try { ws.close(); } catch {}
    }, TIMEOUT_S * 1000);

    function sendCodeInRawRepl() {
      if (result.codeInjected) return;
      result.codeInjected = true;
      info('Stage 3: raw REPL confirmed → sending code (64-byte chunks)');
      const codeBytes = Array.from(new TextEncoder().encode(INJECT_CODE));
      const CHUNK = 64, DELAY = 150;
      let offset = 0;
      const sendChunk = () => {
        if (offset >= codeBytes.length) {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'esp32_serial_input', data: { bytes: [0x04] } }));
            info('Ctrl+D sent — code executing');
          }, 300);
          return;
        }
        const chunk = codeBytes.slice(offset, offset + CHUNK);
        ws.send(JSON.stringify({ type: 'esp32_serial_input', data: { bytes: chunk } }));
        offset += CHUNK;
        setTimeout(sendChunk, DELAY);
      };
      sendChunk();
    }

    ws.addEventListener('open', () => {
      ok('WebSocket connected');
      ws.send(JSON.stringify({
        type: 'start_esp32',
        data: {
          board: 'esp32',
          firmware_b64,
          sensors: [],
          wifi_enabled: true,  // CRITICAL: must be true so QEMU adds the WiFi NIC
        },
      }));
      info('Sent start_esp32 with wifi_enabled=true');
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, data } = msg;

      if (type === 'system') {
        result.systemEvents.push(data);
        info(`system: ${JSON.stringify(data)}`);
        if (data?.event === 'reboot') {
          warn('!!! REBOOT detected (likely TWDT or panic)');
          result.reboot = true;
        }
        return;
      }

      if (type === 'serial_output') {
        const text = data?.data ?? '';
        serialBuf += text;
        for (const ch of text) process.stdout.write(ch);

        if (replState === 'idle' && serialBuf.includes('Type "help()"')) {
          replState = 'banner_seen';
          info('Stage 1: banner seen → poking UART with \\r');
          setTimeout(() => ws.send(JSON.stringify({
            type: 'esp32_serial_input', data: { bytes: [0x0D] }
          })), 800);
        }
        if (replState === 'banner_seen' && serialBuf.includes('>>>')) {
          replState = 'prompt_seen';
          result.replReady = true;
          serialBuf = '';
          ok('Stage 2: >>> seen → sending Ctrl+A');
          setTimeout(() => ws.send(JSON.stringify({
            type: 'esp32_serial_input', data: { bytes: [0x01] }
          })), 200);
        }
        if (replState === 'prompt_seen' && serialBuf.includes('raw REPL')) {
          replState = 'raw_repl_entered';
          serialBuf = '';
          setTimeout(sendCodeInRawRepl, 200);
        }

        for (const m of ['VLX_PRE', 'VLX_IMPORT_OK', 'VLX_WLAN_OK', 'VLX_DONE']) {
          if (text.includes(m)) result.markers.add(m);
        }
        if (result.markers.has('VLX_DONE')) {
          ok('Reached VLX_DONE — test complete');
          setTimeout(() => { try { ws.close(); } catch {} }, 400);
        }
        if (serialBuf.length > 4096) serialBuf = serialBuf.slice(-1024);
      }
    });

    ws.addEventListener('close', ev => {
      clearTimeout(globalTimer);
      result.wsCloseCode = ev.code;
      info(`WebSocket closed (code=${ev.code})`);
      resolve(result);
    });
    ws.addEventListener('error', ev => err('WebSocket error', ev.message ?? ''));
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  Phase 7.1 — MicroPython network.WLAN(STA_IF) trace capture');
  console.log('='.repeat(70) + '\n');
  info(`Backend: ${BACKEND}`);
  info(`Timeout: ${TIMEOUT_S}s`);

  const fw = await downloadFirmware();
  const image = buildFlashImage(fw);
  const b64 = toBase64(image);

  const r = await runSimulation(b64);

  console.log('\n' + '─'.repeat(70));
  console.log('  Results');
  console.log('─'.repeat(70));
  console.log(`  REPL ready:       ${r.replReady}`);
  console.log(`  Code injected:    ${r.codeInjected}`);
  console.log(`  Markers reached:  ${JSON.stringify([...r.markers])}`);
  console.log(`  System reboot:    ${r.reboot}`);
  console.log(`  System events:    ${r.systemEvents.length}`);
  console.log(`  WS close code:    ${r.wsCloseCode ?? '(open)'}`);
  console.log(`  Timed out:        ${r.timedOut}`);
  console.log('─'.repeat(70) + '\n');

  console.log('Now run:');
  console.log(`  docker logs velxio-app 2>&1 | grep -E '\\[(wifi|phya|ana )\\]' | tail -200`);
  console.log('to see the captured WiFi register trace.\n');

  process.exit(r.markers.has('VLX_DONE') ? 0 : 1);
}

main().catch(e => { err('Fatal:', e.message); process.exit(2); });
