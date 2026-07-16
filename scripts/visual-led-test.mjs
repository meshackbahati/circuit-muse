// scripts/visual-led-test.mjs
//
// Automated visual LED test — drives the running vite + backend stack via
// the Chrome DevTools Protocol (CDP). For each named example it:
//
//   1. Navigates to /example/<slug>
//   2. Clicks the Run button (auto-compiles + starts the sim)
//   3. Waits up to `simulateMs` for the LED brightness to swing
//   4. Asserts: `wokwi-led.brightness > 0` AT LEAST ONCE (LED lights up)
//   5. Asserts: `wokwi-led.brightness == 0` AT LEAST ONCE (LED toggles off)
//      — this catches "stuck on" bugs the snapshot tests miss.
//
// Why this matters: unit tests + snapshot tests check static structure
// (netlist string, SPICE cards). They don't run firmware, don't render
// LEDs, and don't observe whether `wokwi-led.brightness` ever moves. Every
// LED-related bug in the recent sprint (INPUT_PULLUP false positive,
// hyphen-truncated V-source, missing pushbutton init, ESP32-C3 compile
// failure) shipped past green unit tests and was only caught by manual
// browser checks. This script makes that check repeatable.
//
// Prerequisites:
//   - Chrome running with `--remote-debugging-port=9222`
//   - `vite` on http://localhost:5174
//   - `uvicorn app.main:app --port 8001` with arduino-cli + cores
//
// Usage:
//   node scripts/visual-led-test.mjs               # default suite
//   node scripts/visual-led-test.mjs blink-led     # single example
//   FRONTEND=http://localhost:5175 node scripts/visual-led-test.mjs
//
// Exits 0 on PASS, 1 on FAIL.

const CDP_HTTP = process.env.CDP_HTTP || 'http://localhost:9222';
const FRONTEND = process.env.FRONTEND || 'http://localhost:5174';

// Each entry: { slug, label?, simulateMs?, expectToggle?, allowAlwaysOn? }
//   expectToggle (default true) — require BOTH a lit sample AND a dark
//     sample. Disable for "permanently on" sketches like sensor read-outs.
//   allowAlwaysOn — accept "lit but never off" as a pass (still requires lit).
//   simulateMs — total observation window after Run (default 12000).
const DEFAULT_SUITE = [
  { slug: 'blink-led', label: 'Blink (AVR digitalWrite)', simulateMs: 12000 },
  { slug: 'button-led', label: 'Button + INPUT_PULLUP', simulateMs: 6000,
    expectInitialOff: true, expectLitAfterRun: false,
    note: 'LED MUST be off idle AND stay off without button press — catches INPUT_PULLUP false positive' },
  { slug: 'traffic-light', label: 'Multi-pin sequencing', simulateMs: 14000 },
  { slug: 'fade-led', label: 'PWM fade gradient', simulateMs: 14000,
    expectGradient: true,
    note: 'Brightness must hit 3+ distinct non-zero values (smooth fade)' },
  { slug: 'rgb-led', label: 'RGB 3-PWM driven', simulateMs: 12000,
    leafCheck: 'rgbLed',
    note: 'wokwi-rgb-led ledRed/Green/Blue MUST cycle — catches PinTracer signature bug' },
  { slug: 'uno-7segment', label: '7-segment counter', simulateMs: 8000,
    leafCheck: 'sevenSegment',
    note: 'wokwi-7segment.values MUST hit ≥4 distinct digit patterns — catches the PinResolver-floating bug for any handler that subscribes per pin' },
];

// ── CDP plumbing ──────────────────────────────────────────────────────────

async function getPages() {
  const res = await fetch(`${CDP_HTTP}/json`);
  return await res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(e), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const handlers = this.events.get(msg.method);
        if (handlers) handlers.forEach((h) => h(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ||
          r.exceptionDetails.text || 'eval failed',
      );
    }
    return r.result?.value;
  }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Per-example runner ────────────────────────────────────────────────────

async function runOne(cdp, ex) {
  const simulateMs = ex.simulateMs ?? 12000;
  await cdp.send('Page.navigate', { url: `${FRONTEND}/example/${ex.slug}` });
  // Wait for editor + Run button.
  const waitForEditor = async () => {
    for (let i = 0; i < 60; i++) {
      const has = await cdp.eval(`
        Array.from(document.querySelectorAll('button')).some(b =>
          /^Run/.test(b.getAttribute('title') || ''))
      `);
      if (has) return true;
      await sleep(250);
    }
    return false;
  };
  if (!(await waitForEditor())) return { slug: ex.slug, fail: 'editor never loaded' };

  // Optional pre-Run check — for examples like button-led where the LED
  // MUST be off until interacted with.
  let preRunBrightness = null;
  if (ex.expectInitialOff) {
    // Give SPICE one pass.
    await sleep(2000);
    preRunBrightness = await cdp.eval(`
      (() => {
        const led = document.querySelector('wokwi-led');
        return led?.brightness ?? null;
      })()
    `);
  }

  await cdp.eval(`
    Array.from(document.querySelectorAll('button')).find(b =>
      /^Run/.test(b.getAttribute('title') || ''))?.click()
  `);

  // Poll LED brightness every 250 ms for simulateMs.
  const samples = [];
  const steps = Math.ceil(simulateMs / 250);
  for (let i = 0; i < steps; i++) {
    const reading = await cdp.eval(`
      (() => {
        const leds = Array.from(document.querySelectorAll('wokwi-led'));
        return leds.map(el => ({
          id: el.id,
          brightness: el.brightness,
          value: el.value,
        }));
      })()
    `);
    samples.push({ t: i * 250, leds: reading });
    await sleep(250);
  }

  // ── Assertions ──────────────────────────────────────────────────────────
  const result = { slug: ex.slug, label: ex.label, preRunBrightness, samples: samples.length };

  if (ex.leafCheck === 'pwmActive') {
    // No wokwi-led for RGB — check SPICE outputPins via __spiceDebug.
    const snap = await cdp.eval(`
      (() => {
        const s = window.__spiceDebug?.();
        return s ? { outputPins: s.outputPinsByBoard, branches: s.branchCurrentNames } : null;
      })()
    `);
    const pinCount = snap?.outputPins
      ? Object.values(snap.outputPins).reduce((n, arr) => n + arr.length, 0) : 0;
    result.outputPinCount = pinCount;
    if (pinCount < 3) result.fail = `expected ≥3 pins driven (RGB), got ${pinCount}`;
    return result;
  }

  if (ex.leafCheck === 'rgbLed') {
    // wokwi-rgb-led exposes ledRed/Green/Blue (0-255). Visual correctness
    // requires each channel to take ≥2 distinct values during the cycle.
    // Without that, the SPICE side may be driving the pins but the visual
    // is stuck (the canonical PinTracer-signature bug).
    const rgbSamples = await cdp.eval(`
      (async () => {
        const out = [];
        for (let i = 0; i < 16; i++) {
          const el = document.querySelector('wokwi-rgb-led');
          out.push({ R: el?.ledRed ?? null, G: el?.ledGreen ?? null, B: el?.ledBlue ?? null });
          await new Promise(r => setTimeout(r, 400));
        }
        return out;
      })()
    `, { awaitPromise: true });
    if (!rgbSamples || rgbSamples[0].R === null) {
      result.fail = 'no wokwi-rgb-led element found';
      return result;
    }
    const rs = new Set(rgbSamples.map(s => s.R));
    const gs = new Set(rgbSamples.map(s => s.G));
    const bs = new Set(rgbSamples.map(s => s.B));
    result.distinctR = rs.size; result.distinctG = gs.size; result.distinctB = bs.size;
    if (rs.size < 2 || gs.size < 2 || bs.size < 2) {
      result.fail = `RGB channel(s) stuck — distinct R=${rs.size} G=${gs.size} B=${bs.size} (each MUST be ≥2)`;
    }
    return result;
  }

  if (ex.leafCheck === 'sevenSegment') {
    // wokwi-7segment exposes `values` (length-8 array, segments a..g + dp).
    // A working counter must hit ≥4 distinct patterns during the run.
    const patterns = await cdp.eval(`
      (async () => {
        const out = new Set();
        for (let i = 0; i < 12; i++) {
          const el = document.querySelector('wokwi-7segment');
          if (el?.values) out.add(Array.from(el.values).join(','));
          await new Promise(r => setTimeout(r, 500));
        }
        return [...out];
      })()
    `, { awaitPromise: true });
    result.distinctPatterns = patterns?.length ?? 0;
    if (!patterns || patterns.length < 4) {
      result.fail = `7-seg only ${patterns?.length ?? 0} distinct pattern(s) — display stuck or not driving segments`;
    }
    return result;
  }

  // Standard LED assertions.
  if (samples[0].leds.length === 0) {
    // No wokwi-led on canvas — only validate SPICE pin activity.
    const snap = await cdp.eval(`
      (() => { const s = window.__spiceDebug?.(); return s ? s.outputPinsByBoard : null; })()
    `);
    const pinCount = snap ? Object.values(snap).reduce((n, arr) => n + arr.length, 0) : 0;
    result.noLed = true;
    result.outputPinCount = pinCount;
    if (pinCount === 0) result.fail = 'no LED and no MCU pins driven';
    return result;
  }

  const ledId = samples[0].leds[0].id;
  const bvals = samples.map(s => s.leds.find(l => l.id === ledId)?.brightness ?? 0);
  const maxB = Math.max(...bvals);
  const minB = Math.min(...bvals);
  const distinct = new Set(bvals.map(b => Math.round(b * 100))).size;
  result.led = ledId;
  result.maxBrightness = Math.round(maxB * 100) / 100;
  result.minBrightness = Math.round(minB * 100) / 100;
  result.distinctLevels = distinct;

  if (ex.expectInitialOff && preRunBrightness != null && preRunBrightness > 0.05) {
    result.fail = `pre-Run LED brightness ${preRunBrightness.toFixed(2)} — INPUT_PULLUP false positive?`;
    return result;
  }

  // expectLitAfterRun:false → button-led style: LED must stay dark without
  // user interaction. PASS if LED stays under 0.05. FAIL only if it lights
  // up (which would mean the firmware is misreading the pin).
  if (ex.expectLitAfterRun === false) {
    if (maxB > 0.05) {
      result.fail = `LED lit without user interaction (max=${maxB.toFixed(2)}) — firmware likely reading wrong pin state`;
    }
    return result;
  }

  if (maxB < 0.05) {
    result.fail = `LED never lit (max brightness ${maxB.toFixed(3)})`;
    return result;
  }

  if (ex.expectGradient) {
    // Smooth fade: require ≥3 distinct brightness buckets across the run.
    if (distinct < 3) {
      result.fail = `PWM fade only ${distinct} distinct level(s) — expected smooth gradient (≥3)`;
      return result;
    }
  } else if (ex.expectToggle !== false && !ex.allowAlwaysOn) {
    // Toggle: require both a lit AND a dark sample.
    if (minB > 0.05) {
      result.fail = `LED never went dark (min brightness ${minB.toFixed(3)}) — stuck on?`;
      return result;
    }
  }

  return result;
}

// ── Driver ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const suite = args.length
    ? args.map(slug => DEFAULT_SUITE.find(e => e.slug === slug) ?? { slug })
    : DEFAULT_SUITE;

  const pages = await getPages();
  const target = pages.find(p => p.type === 'page' && p.url.startsWith('http'));
  if (!target) {
    console.error('[visual-led] No usable Chrome tab. Open one and re-run.');
    process.exit(2);
  }
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  let failed = 0;
  for (const ex of suite) {
    process.stdout.write(`\n[${ex.slug}] ${ex.label || ''}\n`);
    try {
      const r = await runOne(cdp, ex);
      if (r.fail) {
        console.log(`  FAIL — ${r.fail}`);
        console.log(`         ${JSON.stringify({ maxB: r.maxBrightness, minB: r.minBrightness, distinct: r.distinctLevels, pre: r.preRunBrightness })}`);
        failed++;
      } else {
        let detail;
        if (r.distinctR != null) {
          detail = `RGB channels distinct R=${r.distinctR} G=${r.distinctG} B=${r.distinctB}`;
        } else if (r.distinctPatterns != null) {
          detail = `7-seg patterns=${r.distinctPatterns}`;
        } else if (r.outputPinCount != null && r.maxBrightness == null) {
          detail = `no canvas LED, ${r.outputPinCount} pin(s) driven`;
        } else if (r.outputPinCount != null) {
          detail = `${r.outputPinCount} pin(s) driven, max=${r.maxBrightness} min=${r.minBrightness}`;
        } else {
          detail = `max=${r.maxBrightness} min=${r.minBrightness} levels=${r.distinctLevels}`;
        }
        console.log(`  PASS — ${detail}`);
      }
    } catch (e) {
      console.log(`  ERROR — ${e.message}`);
      failed++;
    }
  }

  cdp.close();
  console.log(`\n${suite.length - failed}/${suite.length} examples passed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[visual-led] fatal:', err);
  process.exit(3);
});
