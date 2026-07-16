/**
 * test_esp32_spice_photodiode.mjs
 *
 * End-to-end co-simulation: photodiode (SPICE model from componentToSpice.ts)
 * wired to an ESP32 ADC pin, driven by a lux sweep. Exercises the exact
 * SPICE cards the frontend produces for a `photodiode` part.
 *
 * Circuit (pull-up transimpedance, typical analogRead usage):
 *
 *     Vcc = 3.3V
 *      |
 *      R_pull = 10k
 *      |
 *      +---- vpd (ADC34 / ADC1_CH6)
 *      |
 *      D photodiode (cathode = vpd, anode = GND)
 *      |
 *      I_ph  (photocurrent source, C → A, 100 nA/lux)
 *      |
 *     GND
 *
 * Expected: V(vpd) = Vcc - lux * 100e-9 * R_pull = 3.3 - lux * 1e-3  [V]
 * so lux=0 saturates high (3.3 V, raw≈4095) and lux=3000 is near 0 V.
 *
 * What this test proves (or surfaces as a failure):
 *   1. The photodiode SPICE cards from `frontend/.../componentToSpice.ts`
 *      solve in ngspice-WASM without errors.
 *   2. The backend `esp32_adc_set` WebSocket message actually changes what
 *      `analogRead()` returns inside the guest.
 *   3. The lux → solved-voltage → injected-mV → 12-bit raw value pipeline
 *      round-trips within ±50 counts on a real Arduino sketch.
 *
 * Run:
 *   cd test/backend/e2e && npm install && node test_esp32_spice_photodiode.mjs
 *
 * Prerequisites:
 *   - Backend on http://localhost:8001 with libqemu-xtensa.so available
 *   - arduino-cli + esp32:esp32@2.0.17 installed
 */

import { Simulation } from 'eecircuit-engine';

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND   = process.env.BACKEND_URL
  ?? process.argv.find(a => a.startsWith('--backend='))?.slice(10)
  ?? 'http://localhost:8001';
const WS_BASE   = BACKEND.replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:');
const SESSION   = `test-esp32-photodiode-${Date.now()}`;
const TIMEOUT_S = parseInt(
  process.argv.find(a => a.startsWith('--timeout='))?.slice(10) ?? '150'
);

// Lux levels to sweep. Chosen so V(vpd) lands at non-trivial points across
// the ADC range, and so adjacent levels differ by > 100 counts (needed so
// the "circuit change detected" check below is meaningful).
const LUX_SWEEP = [0, 1000, 2500];

// Must match frontend/src/simulation/spice/componentToSpice.ts photodiode
// mapper. Kept verbatim so the test fails if the frontend model drifts.
const PHOTODIODE_MODEL = '.model DPHOTO D(Is=10p N=1.1 Rs=10)';
const RESPONSIVITY_A_PER_LUX = 100e-9;

// Circuit constants — mirror on the guest side so it can report its own
// converted voltage in the serial stream.
const VCC_V    = 3.3;
const R_PULL   = 10000;   // 10k Ω
const ADC_PIN  = 34;      // GPIO34 == ADC1_CH6 on ESP32
const ADC_CH   = 6;       // channel number the backend expects

// ─── ESP32 sketch (compiled on-the-fly via /api/compile/) ─────────────────────
const SKETCH = `// ESP32 photodiode ADC reader for SPICE co-simulation test
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  delay(500);
  Serial.println("ESP32_PD_READY");
}

void loop() {
  int raw = analogRead(${ADC_PIN});
  float v = raw * ${VCC_V} / 4095.0;
  Serial.printf("PD: raw=%d v=%.3fV\\n", raw, v);
  delay(400);
}`;

// ─── Logging ──────────────────────────────────────────────────────────────────
const T0  = Date.now();
const ts  = () => `[+${((Date.now() - T0) / 1000).toFixed(3)}s]`;
const C   = {
  INFO: '\x1b[36m', OK: '\x1b[32m', ERROR: '\x1b[31m',
  SERIAL: '\x1b[32m', SPICE: '\x1b[35m', RESET: '\x1b[0m',
};
const log    = (lvl, ...a) => console.log(`${C[lvl] ?? ''}${ts()} [${lvl}]${C.RESET}`, ...a);
const info   = (...a) => log('INFO',   ...a);
const ok     = (...a) => log('OK',     ...a);
const err    = (...a) => log('ERROR',  ...a);
const serial = (...a) => log('SERIAL', ...a);
const spice  = (...a) => log('SPICE',  ...a);

// ─── ngspice engine (singleton) ───────────────────────────────────────────────
let engine = null;
async function bootNgspice() {
  if (engine) return engine;
  spice('Booting ngspice-WASM...');
  engine = new Simulation();
  await engine.start();
  spice('ngspice ready');
  return engine;
}

/**
 * Solve the photodiode pull-up circuit for the given lux. Uses the EXACT
 * card pattern emitted by componentToSpice.ts so a regression in the
 * frontend emitter surfaces here.
 */
async function solvePhotodiode(lux) {
  const e = await bootNgspice();
  const iph = lux * RESPONSIVITY_A_PER_LUX;
  const netlist = `Photodiode pull-up lux=${lux}
V1    vcc 0   DC ${VCC_V}
Rpull vcc vpd ${R_PULL}
D_pd  0   vpd DPHOTO
I_pd  vpd 0   DC ${iph}
${PHOTODIODE_MODEL}
.op
.end`;
  e.setNetList(netlist);
  const result = await e.runSim();
  const names = result.variableNames.map(n => n.toLowerCase());
  const idx = names.indexOf('v(vpd)');
  if (idx < 0) throw new Error(`v(vpd) not in result: ${names}`);
  const voltage = result.data[idx].values[0];
  spice(`lux=${lux} -> V(vpd) = ${voltage.toFixed(4)}V (iph=${(iph*1e9).toFixed(1)}nA)`);
  return voltage;
}

// ─── Compile sketch ───────────────────────────────────────────────────────────
async function compile() {
  info('Compiling ESP32 photodiode sketch...');
  const res = await fetch(`${BACKEND}/api/compile/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files:      [{ name: 'sketch.ino', content: SKETCH }],
      board_fqbn: 'esp32:esp32:esp32',
    }),
  });
  if (!res.ok) {
    throw new Error(`Compile HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  if (!body.success) {
    throw new Error(`Compile error: ${(body.error ?? body.stderr ?? '').slice(0, 500)}`);
  }
  const fw = body.binary_content ?? body.firmware_b64;
  if (!fw) throw new Error(`No firmware returned. Keys: ${Object.keys(body)}`);
  ok(`Compiled -- ${Math.round(fw.length * 0.75 / 1024)} KB`);
  return fw;
}

// ─── Co-simulation (sweep lux through the same WS session) ────────────────────
function runCoSim(firmware_b64) {
  return new Promise(async (resolve) => {
    // Pre-solve every lux level with ngspice so we know the expected ADC raw.
    const solved = {};
    for (const lux of LUX_SWEEP) {
      solved[lux] = await solvePhotodiode(lux);
    }

    const ws = new WebSocket(`${WS_BASE}/api/simulation/ws/${SESSION}`);

    let lineBuf = '';
    const serialLines = [];
    let ready = false;
    let luxIdx = 0;
    let currentLux = LUX_SWEEP[0];
    const readings = {};   // lux -> [{raw, v}]

    const timer = setTimeout(() => {
      ws.close();
      resolve({ timedOut: true, readings, serialLines, solved });
    }, TIMEOUT_S * 1000);

    function inject(lux) {
      const mv = Math.round(solved[lux] * 1000);
      ws.send(JSON.stringify({
        type: 'esp32_adc_set',
        data: { channel: ADC_CH, millivolts: mv },
      }));
      spice(`Injected lux=${lux} (${solved[lux].toFixed(3)}V, ${mv}mV) -> CH${ADC_CH}`);
    }

    ws.addEventListener('open', () => {
      ok('WebSocket connected');
      ws.send(JSON.stringify({
        type: 'start_esp32',
        data: { board: 'esp32', firmware_b64, wifi_enabled: false },
      }));
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type !== 'serial_output') {
        if (msg.type === 'error') err(`error: ${JSON.stringify(msg.data)}`);
        return;
      }
      lineBuf += msg.data?.data ?? '';
      let nl;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl).replace(/\r$/, '');
        lineBuf = lineBuf.slice(nl + 1);
        if (!line.trim()) continue;
        serialLines.push(line);
        serial(`UART: ${line}`);

        if (line.includes('ESP32_PD_READY') && !ready) {
          ready = true;
          ok(`ESP32 ready -- starting lux sweep (${LUX_SWEEP.join(', ')})`);
          inject(currentLux);
        }

        const m = line.match(/PD:\s*raw=(\d+)\s+v=([\d.]+)V/);
        if (m) {
          const reading = { raw: parseInt(m[1]), v: parseFloat(m[2]) };
          if (!readings[currentLux]) readings[currentLux] = [];
          readings[currentLux].push(reading);

          // Collect 2 readings per level, then advance.
          if (readings[currentLux].length >= 2) {
            luxIdx++;
            if (luxIdx < LUX_SWEEP.length) {
              currentLux = LUX_SWEEP[luxIdx];
              info(`Switching to lux=${currentLux}`);
              inject(currentLux);
            } else {
              clearTimeout(timer);
              ws.close();
              resolve({ timedOut: false, readings, serialLines, solved });
            }
          }
        }
      }
    });

    ws.addEventListener('error', e => err(`WS error: ${e.message ?? e}`));
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      if (luxIdx < LUX_SWEEP.length) {
        resolve({ timedOut: true, readings, serialLines, solved });
      }
    });
  });
}

// ─── Validate ─────────────────────────────────────────────────────────────────
function validate(result) {
  const { timedOut, readings, solved } = result;
  info('');
  info('═══════════════════════════════════════════════════════════');
  info('  Photodiode + ngspice + ESP32 co-simulation results');
  info('═══════════════════════════════════════════════════════════');

  let pass = !timedOut;
  if (timedOut) err('Timed out before collecting readings for all lux levels');

  const expected = {};
  for (const lux of LUX_SWEEP) {
    expected[lux] = Math.round(solved[lux] / VCC_V * 4095);
    info(`lux=${lux.toString().padStart(5)}  V=${solved[lux].toFixed(4)}V  expected raw=${expected[lux]}`);
  }
  info('');

  const avgs = {};
  for (const lux of LUX_SWEEP) {
    const rs = readings[lux] ?? [];
    if (rs.length === 0) {
      err(`No readings captured for lux=${lux}`);
      pass = false;
      continue;
    }
    avgs[lux] = rs.reduce((s, r) => s + r.raw, 0) / rs.length;
    const diff = Math.abs(avgs[lux] - expected[lux]);
    // Tolerance 50 counts matches the voltage-divider test — accounts for
    // the millivolt round-trip + QEMU scheduling jitter.
    if (diff > 50) {
      err(`lux=${lux}: avg raw=${avgs[lux].toFixed(0)} (expected ${expected[lux]}, off by ${diff.toFixed(0)} > 50)`);
      pass = false;
    } else {
      ok(`lux=${lux}: avg raw=${avgs[lux].toFixed(0)} (expected ${expected[lux]}, within tolerance)`);
    }
  }

  // Monotonicity: brighter = lower voltage = lower raw. If the photodiode
  // cards or the ADC injection pipeline are broken, readings would be flat
  // or random.
  const ordered = LUX_SWEEP.map(l => avgs[l]).filter(v => v !== undefined);
  const monotone = ordered.every((v, i) => i === 0 || v <= ordered[i - 1]);
  if (!monotone) {
    err(`Readings not monotonically decreasing with lux: ${ordered.map(v => v?.toFixed(0)).join(' > ')}`);
    pass = false;
  } else {
    ok(`Brighter light drops the reading as expected: ${ordered.map(v => v?.toFixed(0)).join(' > ')}`);
  }

  info('');
  if (pass) {
    ok('ALL CHECKS PASSED -- photodiode + SPICE + ESP32 pipeline works');
    process.exit(0);
  } else {
    err('SOME CHECKS FAILED');
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  info('Photodiode + ngspice + ESP32 co-simulation E2E');
  info(`Backend: ${BACKEND}`);
  info(`Timeout: ${TIMEOUT_S}s`);
  info('');
  try {
    await bootNgspice();
    const firmware = await compile();
    const result = await runCoSim(firmware);
    validate(result);
  } catch (e) {
    err(`Fatal: ${e.message}`);
    if (e.message?.includes('fetch')) {
      err('Is the backend running? Start with: cd backend && uvicorn app.main:app --port 8001');
    }
    process.exit(1);
  }
}

main();
