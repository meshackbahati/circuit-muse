/**
 * test_micropython_i2c_ssd1306_repro.mjs — Phase 1b reproduction test
 *
 * Phase 1 (test_micropython_i2c_minimal) confirmed that I2C(0,...), scan(),
 * and a single-byte writeto(0x3C, b"\xA0") all work without rebooting.
 * The bug must be triggered by something more specific that ssd1306.py does.
 *
 * This test walks the SSD1306_I2C init sequence step by step and prints a
 * marker after every write, so we can see EXACTLY which call is the last
 * one before the chip resets.
 *
 * What ssd1306.SSD1306_I2C(128, 64, i2c) does on construction:
 *   - For each cmd in a 27-entry init list:
 *       i2c.writeto(0x3C, bytes([0x80, cmd]))   # 2-byte writes
 *   - self.fill(0)  # framebuffer fill, no I2C
 *   - self.show()
 *       - 6× writeto(0x3C, bytes([0x80, addr_cmd]))  # set col/page addrs
 *       - i2c.writevto(0x3C, [b"\x40", buffer])      # 1024-byte data dump
 *
 * Markers (last one printed = the suspect):
 *   mp_step0_ok        — I2C ctor
 *   mp_step1_ok devs=…  — scan
 *   mp_step2_ok        — 2-byte writeto (cmd shape)
 *   mp_step3_iter N cmd=0xXX — each cmd of the 27-cmd init loop
 *   mp_step3_ok after_idx=27 — full init survived
 *   mp_step4_ok        — show() prelude (6× addr writes)
 *   mp_step5_ok        — writevto with small payload (8 bytes)
 *   mp_step6_ok        — writevto with full framebuffer (1024 bytes)
 *   mp_done            — all good, no reboot
 *
 * Run:
 *   node --experimental-websocket test/test_micropython_i2c_ssd1306_repro/test.mjs \
 *        --backend=http://localhost:3080 [--timeout=120]
 */

const BACKEND   = process.env.BACKEND_URL
  ?? process.argv.find(a => a.startsWith('--backend='))?.slice(10)
  ?? 'http://localhost:8001';
const WS_BASE   = BACKEND.replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:');
const SESSION   = `test-mp-i2c-ssd1306-${Date.now()}`;
const TIMEOUT_S = parseInt(
  process.argv.find(a => a.startsWith('--timeout='))?.slice(10) ?? '120'
);

const FIRMWARE_URL = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20230426-v1.20.0.bin';
const FLASH_OFFSET = 0x1000;
const FLASH_SIZE   = 4 * 1024 * 1024;

const INJECT_CODE = `
from machine import Pin, I2C
import time

ADDR = 0x3C
i2c = I2C(0, scl=Pin(22), sda=Pin(21))
print("mp_step0_ok")

devs = i2c.scan()
print("mp_step1_ok devs=" + str(devs))

# step 2: same shape ssd1306.write_cmd uses (2-byte writeto with 0x80 prefix)
i2c.writeto(ADDR, bytes([0x80, 0xAE]))
print("mp_step2_ok")

# step 3: full 27-entry init sequence (verbatim from ssd1306.py for 128x64)
INIT = [
    0xAE,        # SET_DISP off
    0x20, 0x00,  # SET_MEM_ADDR horizontal
    0x40,        # SET_DISP_START_LINE | 0
    0xA1,        # SET_SEG_REMAP | 1
    0xA8, 0x3F,  # SET_MUX_RATIO 64-1
    0xC8,        # SET_COM_OUT_DIR | 8
    0xD3, 0x00,  # SET_DISP_OFFSET 0
    0xDA, 0x12,  # SET_COM_PIN_CFG 0x12
    0xD5, 0x80,  # SET_DISP_CLK_DIV
    0xD9, 0xF1,  # SET_PRECHARGE
    0xDB, 0x30,  # SET_VCOM_DESEL
    0x81, 0xFF,  # SET_CONTRAST
    0xA4,        # SET_ENTIRE_ON
    0xA6,        # SET_NORM_INV
    0x8D, 0x14,  # SET_CHARGE_PUMP
    0xAF,        # SET_DISP on
]
for idx, cmd in enumerate(INIT):
    i2c.writeto(ADDR, bytes([0x80, cmd]))
    print("mp_step3_iter " + str(idx) + " cmd=0x" + ("%02x" % cmd))
print("mp_step3_ok after_idx=" + str(len(INIT)))

# step 4: 6 address commands (.show() prelude)
for cmd in (0x21, 32, 32 + 127, 0x22, 0, 7):
    i2c.writeto(ADDR, bytes([0x80, cmd]))
print("mp_step4_ok")

# step 5: writevto with small payload (8 bytes)
try:
    i2c.writevto(ADDR, (b"\\x40", bytes([0]*8)))
    print("mp_step5_ok")
except Exception as e:
    print("mp_step5_err " + repr(e))

# step 6: writevto with full 1024-byte framebuffer payload
try:
    i2c.writevto(ADDR, (b"\\x40", bytes([0]*1024)))
    print("mp_step6_ok")
except Exception as e:
    print("mp_step6_err " + repr(e))

print("mp_done")
`.trim();

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
      markers: [],
      lastMarker: null,
      step3Iters: 0,
      step3LastCmd: null,
      step5Status: null,
      step6Status: null,
      done: false,
      reboot: false,
      systemEvents: [],
      wsCloseCode: null,
      serialBuf: '',
      timedOut: false,
    };

    let replState = 'idle';
    let serialBuf = '';

    const globalTimer = setTimeout(() => {
      info(`Global timeout (${TIMEOUT_S}s)`);
      result.timedOut = true;
      try { ws.close(); } catch {}
    }, TIMEOUT_S * 1000);

    const finish = () => {
      clearTimeout(globalTimer);
      resolve(result);
    };

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
          sensors: [{ sensor_type: 'ssd1306', pin: 200 + 0x3C, addr: 0x3C }],
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
        result.systemEvents.push(data);
        info(`system: ${JSON.stringify(data)}`);
        if (data?.event === 'reboot' || data?.status === 'reboot') {
          warn('!!! ESP32 REBOOTED — last marker before reboot: ' + (result.lastMarker || '(none)'));
          result.reboot = true;
        }
        return;
      }

      if (type === 'serial_output') {
        const text = data?.data ?? '';
        serialBuf += text;
        for (const ch of text) process.stdout.write(ch);

        // 4-stage REPL state machine
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

        // Parse markers line by line
        let nl;
        while ((nl = serialBuf.indexOf('\n')) !== -1) {
          const line = serialBuf.slice(0, nl).replace(/\r$/, '');
          serialBuf  = serialBuf.slice(nl + 1);
          if (!line.trim()) continue;

          const m = line.match(/mp_(step\d|done)\w*(?:\s+(.+))?/);
          if (m) {
            const tag  = 'mp_' + m[1] + (m[0].slice(3 + m[1].length).match(/^_[a-z]+/)?.[0] ?? '');
            const tail = (m[2] || '').trim();
            const full = tail ? `${tag} ${tail}` : tag;
            result.markers.push(full);
            result.lastMarker = full;
          }
          const iter = line.match(/mp_step3_iter (\d+) cmd=0x([0-9a-f]{2})/);
          if (iter) {
            result.step3Iters  = parseInt(iter[1]) + 1;
            result.step3LastCmd = '0x' + iter[2];
          }
          if (line.includes('mp_step5_ok')) result.step5Status = 'ok';
          if (line.includes('mp_step5_err')) result.step5Status = line.slice(line.indexOf('mp_step5_err'));
          if (line.includes('mp_step6_ok')) result.step6Status = 'ok';
          if (line.includes('mp_step6_err')) result.step6Status = line.slice(line.indexOf('mp_step6_err'));
          if (line.includes('mp_done'))     {
            result.done = true;
            setTimeout(() => { try { ws.close(); } catch {} finish(); }, 400);
          }
          if (line.includes('Traceback')) warn(`TRACEBACK: ${line}`);
        }
        if (serialBuf.length > 8192) serialBuf = serialBuf.slice(-1024);
        return;
      }

      if (type === 'error') {
        err(`backend error: ${JSON.stringify(data)}`);
      }
    });

    ws.addEventListener('close', ev => {
      result.wsCloseCode = ev.code;
      info(`WebSocket closed (code=${ev.code})`);
      finish();
    });
    ws.addEventListener('error', ev => err('WebSocket error', ev.message ?? ''));
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  Phase 1b — SSD1306_I2C init sequence step-by-step reproduction');
  console.log('='.repeat(70) + '\n');
  info(`Backend: ${BACKEND}`);
  info(`Timeout: ${TIMEOUT_S}s`);

  const fw = await downloadFirmware();
  const image = buildFlashImage(fw);
  const b64 = toBase64(image);
  info(`Flash image: ${Math.round(b64.length / 1024)} KB base64`);

  const r = await runSimulation(b64);

  console.log('\n' + '─'.repeat(70));
  console.log('  Results');
  console.log('─'.repeat(70));
  console.log(`  REPL ready:           ${r.replReady}`);
  console.log(`  Code injected:        ${r.codeInjected}`);
  console.log(`  Last marker:          ${r.lastMarker ?? '(none)'}`);
  console.log(`  Step3 init iters OK:  ${r.step3Iters} / 27`);
  console.log(`  Step3 last cmd OK:    ${r.step3LastCmd ?? '(none)'}`);
  console.log(`  Step5 (writevto 8B):  ${r.step5Status ?? '(not reached)'}`);
  console.log(`  Step6 (writevto 1KB): ${r.step6Status ?? '(not reached)'}`);
  console.log(`  System reboot:        ${r.reboot}`);
  console.log(`  WS close code:        ${r.wsCloseCode ?? '(open)'}`);
  console.log(`  Timed out:            ${r.timedOut}`);
  console.log('─'.repeat(70) + '\n');

  if (r.done && !r.reboot) {
    ok('Full SSD1306 init sequence completed without reboot.');
    process.exit(0);
  }
  if (r.reboot) {
    err('REBOOT REPRODUCED. Suspect = last marker before reboot.');
    console.log('  → ' + (r.lastMarker || '(no markers — reboot before any marker)'));
    process.exit(1);
  }
  warn('Inconclusive: no reboot but no mp_done either. See serial output above.');
  process.exit(3);
}

main().catch(e => { err('Fatal:', e.message); console.error(e.stack); process.exit(2); });
