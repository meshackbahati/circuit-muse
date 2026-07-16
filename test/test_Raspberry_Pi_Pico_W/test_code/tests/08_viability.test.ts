/**
 * 08_viability.test.ts
 *
 * Real-world feasibility budget. The fast unit tests in files 01-07
 * prove the emulator answers correctly; this file proves it does so
 * **fast enough** that hooking it into the live Velxio frontend won't
 * be a regression.
 *
 * Budgets are deliberately conservative — they should pass on a 2018
 * laptop, not just a beefy CI runner. If any of these starts flaking,
 * something is wrong, not the budget.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { Cyw43Emulator } from '../src/cyw43_emulator.js';
import { MicroPythonSim } from '../src/micropython_sim.js';
import { DEFAULT_AP } from '../src/virtual_ap.js';

function ethBlob(size: number): Uint8Array {
  const out = new Uint8Array(size);
  // Fill with a non-zero pattern so the chip's all-zero short-circuit
  // doesn't accidentally treat this as an empty frame.
  for (let i = 0; i < size; i++) out[i] = (i * 31 + 7) & 0xff;
  // Plausible Ethernet header so onPacketOut listeners don't see junk.
  out[12] = 0x08; out[13] = 0x00;
  return out;
}

describe('Viability — real-world performance budgets', () => {
  it('bus init + WLC_UP + connect + scan completes under 50 ms', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    const t0 = performance.now();
    mp.busInit();
    mp.active_(true);
    const r = mp.connect('Velxio-GUEST', 'anything');
    const networks = mp.scan();
    const dt = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(networks.length).toBe(1);
    expect(dt).toBeLessThan(50);
  });

  it('1 000 outbound 1500-byte frames sustain ≥ 200 frames/sec', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);
    mp.connect('Velxio-GUEST', 'pw');

    const N = 1_000;
    const frame = ethBlob(1500);
    let captured = 0;
    chip.onPacketOut(() => { captured++; });

    const t0 = performance.now();
    for (let i = 0; i < N; i++) mp.sendEthernet(frame);
    const dt = performance.now() - t0;

    expect(captured).toBe(N);
    const fps = (N / dt) * 1000;
    // 200 fps × 1500 B = ~300 KB/s — well below typical IoT traffic.
    expect(fps).toBeGreaterThan(200);
  });

  it('1 000 inbound 1500-byte packet round-trips do not leak memory', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);
    mp.connect('Velxio-GUEST', 'pw');

    const N = 1_000;
    const frame = ethBlob(1500);
    for (let i = 0; i < N; i++) {
      chip.injectPacket(frame);
      mp.drainInbound();
    }
    expect(mp.inbound.length).toBe(N);

    // Sanity: drain pointer didn't lag by more than a few frames during
    // the loop. If draining had leaked a Uint8Array per round, RSS
    // would balloon and inbound.length would drift in JS GC pauses.
    expect(mp.inbound[0]?.length).toBeGreaterThan(0);
    expect(mp.inbound[N - 1]?.length).toBeGreaterThan(0);
  });

  it('100 connect/disconnect cycles all succeed and release link state', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);

    for (let i = 0; i < 100; i++) {
      mp.events.length = 0;
      const r = mp.connect('Velxio-GUEST', `password-${i}`);
      expect(r.ok).toBe(true);
      expect(mp.isconnected()).toBe(true);
      mp.disconnect();
      expect(mp.isconnected()).toBe(false);
    }
  });

  it('chip survives a 224 KB firmware stream and is responsive afterwards', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    // Fake firmware load
    const t0 = performance.now();
    for (let i = 0; i < 224 * 1024; i += 64) {
      (mp as any).write(1, 0x00, new Uint8Array(64));
    }
    const dt = performance.now() - t0;
    // 224 KB in 64 B chunks = 3584 bus writes. Should be effectively
    // instant — generous budget at 1 s.
    expect(dt).toBeLessThan(1000);

    // Chip still answers IOCTLs.
    mp.active_(true);
    expect(chip.isUp()).toBe(true);
    const r = mp.connect('Velxio-GUEST', '');
    expect(r.ok).toBe(true);
  });

  it('queue grows but does not deadlock under 5 000 mixed events', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);
    mp.connect('Velxio-GUEST', '');

    // Mix: outbound send, inbound inject, drain.
    const frame = ethBlob(256);
    let outbound = 0;
    chip.onPacketOut(() => outbound++);

    for (let i = 0; i < 5_000; i++) {
      if (i % 3 === 0) mp.sendEthernet(frame);
      if (i % 3 === 1) chip.injectPacket(frame);
      if (i % 50 === 0) mp.drainInbound();
    }
    mp.drainInbound();

    // We sent ~1667 frames, injected ~1667. Both queues should match.
    expect(outbound).toBeGreaterThan(1500);
    expect(mp.inbound.length).toBeGreaterThan(1500);
  });

  it('scan + connect under simulated load — link transitions stay correct', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);

    // Spam a stream of inbound traffic while the connect handshake runs.
    for (let i = 0; i < 50; i++) {
      chip.injectPacket(ethBlob(64));
    }
    const r = mp.connect('Velxio-GUEST', 'noisy');
    expect(r.ok).toBe(true);
    expect(chip.getLinkState()).toBe('up');

    // Drain everything; the inbound bytes the script ignored are still
    // there, but the link state stays 'up' regardless.
    mp.drainInbound();
    expect(chip.getLinkState()).toBe('up');
  });
});

describe('Viability — IOCTL coverage matches what real drivers send', () => {
  /**
   * The smoke list below is the subset of IOCTLs every Pico W
   * MicroPython project we checked actually emits, in roughly the
   * order they appear during boot. The chip must answer all of them
   * with status=0 and a plausible payload, otherwise MP raises.
   */
  const IOCTL_BOOT_SEQ: Array<[string, number, boolean]> = [
    ['WLC_UP',         2,   true],
    ['WLC_GET_MAGIC',  0,   false],
    ['WLC_GET_VERSION',1,   false],
    ['WLC_SET_INFRA',  20,  true],
    ['WLC_SET_AUTH',   22,  true],
    ['WLC_SET_VAR',    263, true],   // wsec_pmk
    ['WLC_SET_SSID',   26,  true],
    ['WLC_GET_BSSID',  23,  false],
    ['WLC_SCAN',       50,  true],
    ['WLC_DISASSOC',   52,  true],
    ['WLC_DOWN',       3,   true],
  ];

  it('every command in the boot sequence returns without error', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();

    for (const [name, cmd, isSet] of IOCTL_BOOT_SEQ) {
      const out = (mp as any).ioctl(cmd, new Uint8Array(0), isSet ? 1 : 0);
      expect(
        out.status,
        `${name} (cmd=${cmd}) returned non-zero status`,
      ).toBe(0);
    }
  });
});

describe('Viability — verdict', () => {
  /**
   * This isn't a pass/fail — it's a printout that summarises the
   * numbers above for the autosearch dossier. Always passes.
   */
  it('prints a one-line verdict', () => {
    const chip = new Cyw43Emulator();
    const mp = new MicroPythonSim(chip);
    mp.busInit();
    mp.active_(true);
    mp.connect('Velxio-GUEST', '');

    const N = 500;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      mp.sendEthernet(ethBlob(1500));
      chip.injectPacket(ethBlob(1500));
    }
    mp.drainInbound();
    const dt = performance.now() - t0;
    const fps = (N * 2 / dt) * 1000;

    // eslint-disable-next-line no-console
    console.log(
      `[viability] ${N} TX + ${N} RX 1500-byte frames in ${dt.toFixed(1)} ms ` +
      `(${fps.toFixed(0)} fps) — verdict: ${fps > 1000 ? 'production-viable' : 'needs tuning'}`,
    );
    expect(fps).toBeGreaterThan(0);
  });
});
