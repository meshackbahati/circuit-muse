/**
 * Pico Doom raycaster — performance profiler.
 *
 * Why this exists
 * ---------------
 * The Doom example renders ~5 of 160 expected wall columns per frame.
 * It's not a logic bug — the simulator is too slow to process every
 * SPI byte the sketch emits before the next frame's writes pile on.
 *
 * This script measures where the time goes:
 *
 *   1. rp2040js CPU step rate (cycles/sec executed) vs the simulated Pico's
 *      125 MHz target. If we get <10 MHz, the chip is running at <8 % real
 *      time — that alone explains why frames don't finish.
 *   2. SPI bytes/sec passing through `rp2040.spi[0].onTransmit`. Tells us
 *      whether the SPI peripheral is the choke point.
 *   3. ILI9341 `writePixel` calls/sec — the per-pixel work inside the
 *      simulator (color decode + imageData write + curX/curY bookkeeping).
 *   4. Canvas `putImageData` calls/sec — the actual paint cost.
 *   5. requestAnimationFrame rate the simulator is being driven at.
 *
 * Reading the output
 * ------------------
 *   CPU step rate < 10 MHz       → rp2040js is the bottleneck (CPU emulation)
 *   SPI bytes < 1 MHz but CPU OK → the SPI byte hook chain is slow
 *   writePixel < 250k/s          → ILI9341 per-pixel work is slow
 *   putImageData < 60/s          → canvas painting is slow (unlikely cause)
 *
 * For a healthy Doom run we need ≈ 340 KB/s SPI throughput sustained,
 * which means ≈ 340k writePixel calls/sec.
 *
 * Usage
 * -----
 *   1. In one terminal: cd backend && uvicorn app.main:app --port 8001
 *   2. In another:      cd frontend && npx vite --port 5173
 *   3. node test/pico_doom_demo/raycaster-perf.mjs
 *      [--example=pico-doom-raycaster] [--duration=15]
 *
 * Output is a JSON report on stdout plus a human-readable summary on stderr.
 */

import puppeteer from 'puppeteer-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const EXAMPLE = args.example || 'pico-doom-raycaster';
const DURATION_S = parseInt(args.duration ?? '15', 10);
const URL = `http://127.0.0.1:5173/example/${EXAMPLE}`;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function fmt(n, unit = '') {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M' + unit;
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' K' + unit;
  return n.toFixed(2) + ' ' + unit;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();

const consoleLogs = [];
page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLogs.push(`[error] ${e.message}`));

process.stderr.write(`▶ Loading ${URL}…\n`);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

// Click Run — kicks off compile + boot.
process.stderr.write('▶ Clicking Run…\n');
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) =>
    /^run/i.test((b.title || b.textContent || '').trim()),
  );
  if (btn) btn.click();
});

// Wait for the compile to finish + rp2040 to boot + the sketch to install its
// MADCTL + sky/floor first frame. Conservative; raise if your local compile
// takes longer than ~25 s.
process.stderr.write('▶ Waiting 25 s for compile + boot…\n');
await new Promise((r) => setTimeout(r, 25000));

// The Pico Doom sketch parks in drawTitleScreen() waiting for FWD. Long-press
// the synthetic button so the sketch advances into the raycaster main loop.
process.stderr.write('▶ Holding FWD for 1.5 s…\n');
await page.evaluate(() => {
  document
    .getElementById('btn-fwd')
    ?.dispatchEvent(new CustomEvent('button-press', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  document
    .getElementById('btn-fwd')
    ?.dispatchEvent(new CustomEvent('button-release', { bubbles: true }));
});

// Give the sketch a beat to enter loop()
await new Promise((r) => setTimeout(r, 1500));

// Install probes via Vite's HMR import path.
process.stderr.write('▶ Installing perf probes…\n');
await page.evaluate(async () => {
  const sim = (await import('/src/store/useSimulatorStore.ts')).useSimulatorStore.getState().simulator;
  if (!sim || !sim.rp2040) throw new Error('No RP2040Simulator running');

  const counters = {
    spiBytes: 0,
    cpuStepsAtStart: 0,
    cpuStepsAtEnd: 0,
    writePixelCalls: 0,
    writePixelTimeNs: 0n,
    putImageDataCalls: 0,
    putImageDataTimeNs: 0n,
    cmdCounts: {},
  };
  // Stash on window for retrieval
  window.__perfCounters = counters;

  // ── SPI bytes — wrap onTransmit ─────────────────────────────────────
  const spi0 = sim.rp2040.spi[0];
  const origOnTransmit = spi0.onTransmit;
  spi0.onTransmit = (v) => {
    counters.spiBytes++;
    origOnTransmit(v);
  };

  // ── writePixel + putImageData on the ILI9341 canvas ────────────────
  // Find the wokwi-ili9341 canvas. The simulator's writePixel writes into an
  // ImageData; on flush it calls ctx.putImageData(...). We wrap putImageData
  // and getImageData on the canvas's 2d context to count flushes; for
  // writePixel we count via a heuristic: each ILI9341 RAMWR byte pair becomes
  // a writePixel, so a finer-grained probe needs in-source instrumentation
  // (added separately). For now: spi bytes minus the cmd/setAddrWindow bytes
  // gives a close enough writePixel count.
  const ili = document.querySelector('wokwi-ili9341');
  const canvas = ili?.shadowRoot?.querySelector('canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const origPut = ctx.putImageData.bind(ctx);
    ctx.putImageData = (...a) => {
      const t = performance.now();
      const r = origPut(...a);
      counters.putImageDataTimeNs += BigInt(Math.round((performance.now() - t) * 1e6));
      counters.putImageDataCalls++;
      return r;
    };
  }

  // ── CPU steps — sample the rp2040 clock counter ────────────────────
  // rp2040js exposes `cycles` (or `clock.nanos`) — we sample now and at end.
  const clock = sim.rp2040.clock;
  counters.cpuStepsAtStart = clock?.nanos ?? sim.rp2040.cycles ?? 0;
  counters.tStartMs = performance.now();
});

// Let the raycaster run for the measurement window.
process.stderr.write(`▶ Measuring for ${DURATION_S} s…\n`);
await new Promise((r) => setTimeout(r, DURATION_S * 1000));

const report = await page.evaluate(() => {
  const sim = window.__zustand_simulator_store?.getState?.()?.simulator;
  const c = window.__perfCounters;
  c.cpuStepsAtEnd = sim?.rp2040?.clock?.nanos ?? sim?.rp2040?.cycles ?? 0;
  c.tEndMs = performance.now();
  return JSON.parse(
    JSON.stringify(c, (_, v) => (typeof v === 'bigint' ? Number(v) : v)),
  );
});

// Try again to read sim from the store now that we don't need pre-set window value
const simReport = await page.evaluate(async () => {
  const mod = await import('/src/store/useSimulatorStore.ts');
  const sim = mod.useSimulatorStore.getState().simulator;
  const c = window.__perfCounters;
  c.cpuStepsAtEnd = sim?.rp2040?.clock?.nanos ?? sim?.rp2040?.cycles ?? c.cpuStepsAtEnd;
  return JSON.parse(
    JSON.stringify(c, (_, v) => (typeof v === 'bigint' ? Number(v) : v)),
  );
});

await browser.close();

const c = simReport;
const elapsedS = (c.tEndMs - c.tStartMs) / 1000;
// rp2040js exposes cycles in nanoseconds in its `clock.nanos` getter — convert
// to wall-clock-cycle-equivalent based on the chip's nominal 125 MHz.
const simNanosDelta = c.cpuStepsAtEnd - c.cpuStepsAtStart;
const simSeconds = simNanosDelta / 1e9;
const realtimeRatio = simSeconds / elapsedS;
// Estimated cycles = simSeconds × 125 MHz
const cpuCyclesPerSec = (simSeconds * 125e6) / elapsedS;

const spiBytesPerSec = c.spiBytes / elapsedS;
const putImageDataPerSec = c.putImageDataCalls / elapsedS;
const putImageDataAvgMs =
  c.putImageDataCalls > 0
    ? c.putImageDataTimeNs / 1e6 / c.putImageDataCalls
    : 0;

const report_out = {
  example: EXAMPLE,
  measureSeconds: elapsedS.toFixed(2),
  simulatedSeconds: simSeconds.toFixed(2),
  realtimeRatio: realtimeRatio.toFixed(3) + 'x',
  cpu: {
    cyclesPerSec: cpuCyclesPerSec,
    cyclesPerSec_fmt: fmt(cpuCyclesPerSec, 'Hz'),
    targetPico: '125 MHz',
    percentOfRealtime: ((cpuCyclesPerSec / 125e6) * 100).toFixed(1) + '%',
  },
  spi: {
    totalBytes: c.spiBytes,
    bytesPerSec: spiBytesPerSec,
    bytesPerSec_fmt: fmt(spiBytesPerSec, 'B/s'),
    doomFrameNeeds: '~340 KB/s sustained for 10 FPS',
  },
  canvas: {
    putImageDataCalls: c.putImageDataCalls,
    putImageDataPerSec,
    putImageDataPerSec_fmt: fmt(putImageDataPerSec, 'fps'),
    avgPutImageDataMs: putImageDataAvgMs.toFixed(2),
  },
};

process.stderr.write('\n══ Pico Doom raycaster perf report ══\n');
process.stderr.write(`Example:               ${EXAMPLE}\n`);
process.stderr.write(`Wall-clock window:     ${report_out.measureSeconds} s\n`);
process.stderr.write(`Simulated time:        ${report_out.simulatedSeconds} s\n`);
process.stderr.write(`Realtime ratio:        ${report_out.realtimeRatio}\n`);
process.stderr.write('\nCPU:\n');
process.stderr.write(`  Effective cycles/s:  ${report_out.cpu.cyclesPerSec_fmt}\n`);
process.stderr.write(`  % of 125 MHz Pico:   ${report_out.cpu.percentOfRealtime}\n`);
process.stderr.write('\nSPI:\n');
process.stderr.write(`  Total bytes:         ${c.spiBytes}\n`);
process.stderr.write(`  Bytes/sec:           ${report_out.spi.bytesPerSec_fmt}\n`);
process.stderr.write(`  Needs for Doom:      ${report_out.spi.doomFrameNeeds}\n`);
process.stderr.write('\nCanvas:\n');
process.stderr.write(`  putImageData calls:  ${c.putImageDataCalls}\n`);
process.stderr.write(`  Calls/sec:           ${report_out.canvas.putImageDataPerSec_fmt}\n`);
process.stderr.write(`  Avg ms per call:     ${report_out.canvas.avgPutImageDataMs}\n`);
process.stderr.write('\nInterpretation:\n');

const verdict = [];
if (cpuCyclesPerSec < 10e6)
  verdict.push(
    '⚠ CPU emulation is the dominant bottleneck (rp2040js < 10 MHz). The sketch never gets enough cycles per second to finish a frame before the next loop iteration.',
  );
else if (spiBytesPerSec < 200e3)
  verdict.push(
    '⚠ SPI byte hook chain is throttling — CPU runs OK but bytes drip through too slowly. The per-byte JS callback (onTransmit → adapter → ili9341 handler) is the candidate to batch.',
  );
else if (putImageDataPerSec < 30)
  verdict.push(
    '⚠ Canvas paint is throttled — too few frame flushes per second. Inspect the rAF-scheduled flush logic in ili9341Simulation.',
  );
else verdict.push('✓ All three measured stages look healthy. The remaining gap is per-pixel JS work or rendering thread contention.');

verdict.forEach((v) => process.stderr.write('  ' + v + '\n'));
process.stderr.write('\n══ end ══\n');

process.stdout.write(JSON.stringify(report_out, null, 2) + '\n');
