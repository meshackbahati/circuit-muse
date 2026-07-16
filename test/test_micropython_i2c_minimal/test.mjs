/**
 * test_micropython_i2c_minimal.mjs — Phase 1 reproduction test
 *
 * Boots ESP32 MicroPython via velxio QEMU, registers an SSD1306 I2C slave
 * at 0x3C, then runs the SMALLEST possible MicroPython program that
 * touches `machine.I2C(0, ...).scan()` and writes one byte. The goal is
 * to confirm in isolation (no SSD1306 driver, no helper libs) that the
 * reboot reproduces, narrowing the bug to the QEMU I2C peripheral
 * emulation itself (not the ssd1306.py driver or the example's main.py).
 *
 * EXPECTED FAIL (before the QEMU fix lands):
 *   - REPL boots, code injection succeeds
 *   - Right after `i2c = I2C(0, ...)` the chip reboots (system event=reboot)
 *   - WebSocket closes with code 1006
 *
 * EXPECTED PASS (after the fix):
 *   - `i2c.scan()` returns `[60]` (0x3C — the registered SSD1306 slave)
 *   - `i2c.writeto(0x3C, b'\\x00')` returns OK (no OSError)
 *   - `velxio_i2c_done` marker printed
 *   - No reboot, no premature WS close
 *
 * Heavily based on `test/backend/e2e/test_micropython_esp32.mjs` (same
 * firmware download + 4 MB flash image + raw-REPL injection state machine).
 *
 * Run:
 *   node test/test_micropython_i2c_minimal/test.mjs [--timeout=60] [--backend=http://localhost:8001]
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND   = process.env.BACKEND_URL
  ?? process.argv.find(a => a.startsWith('--backend='))?.slice(10)
  ?? 'http://localhost:8001';
const WS_BASE   = BACKEND.replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:');
const SESSION   = `test-mp-i2c-${Date.now()}`;
const TIMEOUT_S = parseInt(
  process.argv.find(a => a.startsWith('--timeout='))?.slice(10) ?? '60'
);

// Same MicroPython firmware as the frontend ships
const FIRMWARE_URL = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20230426-v1.20.0.bin';
const FLASH_OFFSET = 0x1000;
const FLASH_SIZE   = 4 * 1024 * 1024;

// Minimal I2C test — no ssd1306 driver, no helper libs. Just touches the
// hardware I2C peripheral the same way ssd1306.py does on its first
// write. Each step prints a tag so we can pinpoint which call rebooted.
const INJECT_CODE = [
  'from machine import Pin, I2C',
  'print("velxio_i2c_pre")',           // marker before I2C touch
  'i2c = I2C(0, scl=Pin(22), sda=Pin(21))',
  'print("velxio_i2c_ctor_ok")',       // ctor survived
  'devs = i2c.scan()',
  'print("velxio_i2c_scan_ok", devs)', // scan survived + result
  'try:',
  '    i2c.writeto(0x3C, b"\\xA0")',   // single byte write — same as ssd1306 init does first
  '    print("velxio_i2c_write_ok")',  // write survived
  'except OSError as e:',
  '    print("velxio_i2c_write_err", e)',
  'print("velxio_i2c_done")',
].join('\n');

// ─── Logging ──────────────────────────────────────────────────────────────────
const T0  = Date.now();
const ts  = () => `[+${((Date.now() - T0) / 1000).toFixed(3)}s]`;
const C   = {
  INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m',
  OK: '\x1b[32m', SERIAL: '\x1b[35m', RESET: '\x1b[0m',
};
const log    = (lvl, ...a) => console.log(`${C[lvl] ?? ''}${ts()} [${lvl}]${C.RESET}`, ...a);
const info   = (...a) => log('INFO',   ...a);
const ok     = (...a) => log('OK',     ...a);
const warn   = (...a) => log('WARN',   ...a);
const err    = (...a) => log('ERROR',  ...a);
const serial = (...a) => log('SERIAL', ...a);

// ─── Firmware fetch + 4MB flash image (copied from test_micropython_esp32.mjs) ─
async function downloadFirmware() {
  info(`Downloading MicroPython firmware from ${FIRMWARE_URL} ...`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(FIRMWARE_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    clearTimeout(t);
    ok(`Downloaded ${bytes.length} bytes`);
    return bytes;
  } finally { clearTimeout(t); }
}

function buildFlashImage(firmware) {
  const image = new Uint8Array(FLASH_SIZE).fill(0xFF);
  image.set(firmware, FLASH_OFFSET);
  if (image[FLASH_OFFSET] !== 0xE9) {
    warn(`Unexpected magic at 0x${FLASH_OFFSET.toString(16)}: 0x${image[FLASH_OFFSET].toString(16)}`);
  }
  return image;
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

// ─── Simulation ───────────────────────────────────────────────────────────────
function runSimulation(firmware_b64) {
  return new Promise((resolve) => {
    const wsUrl = `${WS_BASE}/api/simulation/ws/${SESSION}`;
    info(`Connecting WebSocket → ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    const markers = new Set();
    let replState   = 'idle';
    let replReady   = false;
    let codeInjected = false;
    let i2cScanResult = null;
    let writeErr      = null;
    let serialBuf     = '';
    let systemReboot  = false;
    let wsCloseCode   = null;
    const systemEvents = [];

    const globalTimer = setTimeout(() => {
      info(`Global timeout (${TIMEOUT_S}s)`);
      ws.close();
      finish({ timedOut: true });
    }, TIMEOUT_S * 1000);

    function finish(extra = {}) {
      clearTimeout(globalTimer);
      resolve({
        replReady, codeInjected,
        markers: [...markers],
        i2cScanResult, writeErr,
        systemReboot, systemEvents, wsCloseCode,
        ...extra,
      });
    }

    function sendCodeInRawRepl() {
      if (codeInjected) return;
      codeInjected = true;
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
          board:        'esp32',
          firmware_b64,
          // CRITICAL: register the SSD1306 slave at 0x3C so the worker
          // ACKs the write. virtualPin = 200 + addr (per the ProtocolParts
          // pattern in the frontend).
          sensors:      [{ sensor_type: 'ssd1306', pin: 200 + 0x3C, addr: 0x3C }],
          wifi_enabled: false,
        },
      }));
      info('Sent start_esp32 with sensors=[{ssd1306@0x3C}]');
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, data } = msg;

      if (type === 'system') {
        systemEvents.push(data);
        info(`system: ${JSON.stringify(data)}`);
        if (data?.event === 'reboot' || data?.status === 'reboot' || String(data).includes('reboot')) {
          warn('!!! ESP32 REBOOTED — this is the bug we are chasing');
          systemReboot = true;
        }
        return;
      }

      if (type === 'serial_output') {
        const text = data?.data ?? '';
        serialBuf += text;
        for (const ch of text) process.stdout.write(ch);

        // 4-stage state machine (same as the frontend Esp32Bridge)
        if (replState === 'idle' && serialBuf.includes('Type "help()"')) {
          replState = 'banner_seen';
          info('Stage 1: banner seen → poking UART with \\r');
          setTimeout(() => ws.send(JSON.stringify({
            type: 'esp32_serial_input', data: { bytes: [0x0D] }
          })), 800);
        }
        if (replState === 'banner_seen' && serialBuf.includes('>>>')) {
          replState = 'prompt_seen';
          replReady = true;
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

        // Scan line-by-line for our injection markers
        let nl;
        while ((nl = serialBuf.indexOf('\n')) !== -1) {
          const line = serialBuf.slice(0, nl).replace(/\r$/, '');
          serialBuf  = serialBuf.slice(nl + 1);
          if (!line.trim()) continue;

          // velxio_i2c_* markers tell us WHICH I2C call survived
          if (line.includes('velxio_i2c_pre'))        markers.add('pre');
          if (line.includes('velxio_i2c_ctor_ok'))    markers.add('ctor_ok');
          if (line.includes('velxio_i2c_scan_ok')) {
            markers.add('scan_ok');
            const m = line.match(/velxio_i2c_scan_ok\s+(.+)/);
            if (m) i2cScanResult = m[1].trim();
          }
          if (line.includes('velxio_i2c_write_ok'))   markers.add('write_ok');
          if (line.includes('velxio_i2c_write_err')) {
            markers.add('write_err');
            const m = line.match(/velxio_i2c_write_err\s+(.+)/);
            if (m) writeErr = m[1].trim();
          }
          if (line.includes('velxio_i2c_done'))       markers.add('done');

          if (line.includes('Traceback')) warn(`TRACEBACK: ${line}`);
        }

        if (markers.has('done')) {
          ok('Reached velxio_i2c_done — test complete');
          ws.close();
          finish();
        }
        if (serialBuf.length > 4096) serialBuf = serialBuf.slice(-512);
        return;
      }

      if (type === 'error') {
        err(`simulation error: ${JSON.stringify(data)}`);
        return;
      }
    });

    ws.addEventListener('close', ev => {
      wsCloseCode = ev.code;
      info(`WebSocket closed (code=${ev.code})`);
      finish();
    });
    ws.addEventListener('error', ev => err('WebSocket error', ev.message ?? ''));
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  Phase 1 — MicroPython I2C minimal reproduction');
  console.log('='.repeat(70) + '\n');
  info(`Backend: ${BACKEND}`);
  info(`Timeout: ${TIMEOUT_S}s`);

  let exitCode = 0;
  try {
    const fw = await downloadFirmware();
    const image = buildFlashImage(fw);
    const b64 = toBase64(image);
    info(`Flash image: ${Math.round(b64.length / 1024)} KB base64`);

    const r = await runSimulation(b64);

    console.log('\n' + '─'.repeat(70));
    console.log('  Results');
    console.log('─'.repeat(70));
    console.log(`  REPL ready:        ${r.replReady}`);
    console.log(`  Code injected:     ${r.codeInjected}`);
    console.log(`  Markers reached:   ${JSON.stringify(r.markers)}`);
    console.log(`  i2c.scan() result: ${r.i2cScanResult ?? '(never reached)'}`);
    console.log(`  i2c write error:   ${r.writeErr ?? '(none)'}`);
    console.log(`  System reboot:     ${r.systemReboot}`);
    console.log(`  WS close code:     ${r.wsCloseCode ?? '(open)'}`);
    console.log(`  Timed out:         ${r.timedOut ?? false}`);
    console.log('─'.repeat(70) + '\n');

    // Phase 1 diagnostic — we're not asserting PASS yet, we're collecting
    // evidence of WHICH call rebooted. Use the marker set to localize.
    const lastMarker = ['done','write_ok','write_err','scan_ok','ctor_ok','pre']
      .find(m => r.markers.includes(m));

    if (r.systemReboot) {
      const where = lastMarker
        ? `AFTER reaching marker "${lastMarker}"`
        : 'BEFORE any marker (very early — code injection may not have started)';
      console.log(`Bug LOCATION: ESP32 rebooted ${where}.`);
      console.log('  → If lastMarker = "scan_ok": reboot triggered by writeto()');
      console.log('  → If lastMarker = "ctor_ok": reboot triggered by scan()');
      console.log('  → If lastMarker = "pre": reboot triggered by I2C() constructor');
      exitCode = 1;
    } else if (!r.markers.includes('done')) {
      warn('No reboot but test did not complete — likely a different bug. See serial output above.');
      exitCode = 1;
    } else {
      ok(`I2C path complete. scan=${r.i2cScanResult}, writeErr=${r.writeErr ?? 'none'}`);
      if (r.i2cScanResult === '[60]' && !r.writeErr) {
        ok('Phase 1 PASSED — I2C hardware fully functional');
      } else {
        warn(`Phase 1 PARTIAL — scan returned ${r.i2cScanResult} (expected [60]), writeErr=${r.writeErr ?? 'none'}`);
        exitCode = 1;
      }
    }
  } catch (e) {
    err(`Fatal: ${e.message}`);
    console.error(e);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
