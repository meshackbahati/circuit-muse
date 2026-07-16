/**
 * Frontend mirror of test/backend/unit/test_signal_router.py.
 *
 * Covers SignalRouter's core update/clear semantics, multi-pin
 * routing, the symmetric reverse index after re-routes, and the
 * esp32-signals channel↔signal-id translation. The Python side
 * has identical coverage so both ends of the WebSocket stay in
 * lock-step.
 *
 * Fidelity rule (memory `feedback_tests_import_real_code`):
 * imports the real production modules. Adding a new signal in
 * `esp32-signals.ts` only requires a new test case here; nothing
 * duplicates the source-of-truth.
 */

import { describe, it, expect } from 'vitest';
import { SignalRouter } from '../simulation/SignalRouter';
import {
  SIG_LEDC_HS_CH0_OUT_IDX,
  SIG_LEDC_LS_CH0_OUT_IDX,
  channelForLedcSignal,
  ledcSignalForChannel,
} from '../simulation/esp32-signals';


describe('SignalRouter — core update/lookup', () => {
  it('update_routing populates both indexes', () => {
    const r = new SignalRouter();
    r.updateRouting(13, SIG_LEDC_HS_CH0_OUT_IDX);
    expect(r.signalForGpio(13)).toBe(SIG_LEDC_HS_CH0_OUT_IDX);
    expect(r.pinsForSignal(SIG_LEDC_HS_CH0_OUT_IDX)).toEqual([13]);
  });

  it('updateRouting is idempotent — same call twice is a no-op', () => {
    const r = new SignalRouter();
    r.updateRouting(13, SIG_LEDC_HS_CH0_OUT_IDX);
    r.updateRouting(13, SIG_LEDC_HS_CH0_OUT_IDX);
    r.updateRouting(13, SIG_LEDC_HS_CH0_OUT_IDX);
    expect(r.pinsForSignal(SIG_LEDC_HS_CH0_OUT_IDX)).toEqual([13]);
  });

  it('rerouting a pin moves it cleanly across reverse-index sets', () => {
    const r = new SignalRouter();
    const sigA = SIG_LEDC_HS_CH0_OUT_IDX;     // 72
    const sigB = SIG_LEDC_HS_CH0_OUT_IDX + 1; // 73
    r.updateRouting(13, sigA);
    r.updateRouting(13, sigB);
    expect(r.signalForGpio(13)).toBe(sigB);
    expect(r.pinsForSignal(sigA)).toEqual([]);
    expect(r.pinsForSignal(sigB)).toEqual([13]);
  });

  it('multi-pin routing — one signal driving two pins', () => {
    const r = new SignalRouter();
    const sig = SIG_LEDC_HS_CH0_OUT_IDX;
    r.updateRouting(12, sig);
    r.updateRouting(13, sig);
    expect(r.pinsForSignal(sig)).toEqual([12, 13]);
  });

  it('clearRouting removes the pin from both indexes', () => {
    const r = new SignalRouter();
    const sig = SIG_LEDC_HS_CH0_OUT_IDX;
    r.updateRouting(13, sig);
    r.clearRouting(13);
    expect(r.signalForGpio(13)).toBeUndefined();
    expect(r.pinsForSignal(sig)).toEqual([]);
  });

  it('clearRouting is idempotent when the pin was never routed', () => {
    const r = new SignalRouter();
    expect(() => r.clearRouting(99)).not.toThrow();
    expect(r.signalForGpio(99)).toBeUndefined();
  });

  it('pinsForSignal returns a snapshot — safe to iterate during mutation', () => {
    const r = new SignalRouter();
    const sig = SIG_LEDC_HS_CH0_OUT_IDX;
    r.updateRouting(13, sig);
    const snapshot = r.pinsForSignal(sig);
    r.updateRouting(12, sig); // mutate
    expect(snapshot).toEqual([13]);           // snapshot unchanged
    expect(r.pinsForSignal(sig)).toEqual([12, 13]);
  });

  it('routes() iterator returns the full matrix', () => {
    const r = new SignalRouter();
    r.updateRouting(13, 72);
    r.updateRouting(12, 73);
    r.updateRouting(14, 80);
    expect(Object.fromEntries(r.routes())).toEqual({ 12: 73, 13: 72, 14: 80 });
  });

  it('size reflects the number of currently routed pins', () => {
    const r = new SignalRouter();
    expect(r.size).toBe(0);
    r.updateRouting(13, 72);
    r.updateRouting(12, 73);
    expect(r.size).toBe(2);
    r.clearRouting(13);
    expect(r.size).toBe(1);
  });

  it('reset() drops the entire matrix', () => {
    const r = new SignalRouter();
    r.updateRouting(13, 72);
    r.updateRouting(12, 73);
    r.reset();
    expect(r.size).toBe(0);
    expect(r.pinsForSignal(72)).toEqual([]);
    expect(r.signalForGpio(13)).toBeUndefined();
  });
});


describe('esp32-signals — channel ↔ signal id helpers', () => {
  it.each([
    [0,  SIG_LEDC_HS_CH0_OUT_IDX],         // 71 (HS ch 0)
    [7,  SIG_LEDC_HS_CH0_OUT_IDX + 7],     // 78 (HS ch 7)
    [8,  SIG_LEDC_LS_CH0_OUT_IDX],         // 79 (LS ch 0)
    [15, SIG_LEDC_LS_CH0_OUT_IDX + 7],     // 86 (LS ch 7)
  ])('ledcSignalForChannel(%d) roundtrips through channelForLedcSignal → %d', (channel, sig) => {
    expect(ledcSignalForChannel(channel)).toBe(sig);
    expect(channelForLedcSignal(sig)).toBe(channel);
  });

  it('ledcSignalForChannel rejects out-of-range', () => {
    expect(() => ledcSignalForChannel(-1)).toThrow();
    expect(() => ledcSignalForChannel(16)).toThrow();
    expect(() => ledcSignalForChannel(3.5)).toThrow();
  });

  it('channelForLedcSignal returns null for non-LEDC signal ids', () => {
    // 70 sits immediately below the LEDC range, 87 immediately above.
    expect(channelForLedcSignal(0)).toBeNull();
    expect(channelForLedcSignal(70)).toBeNull();
    expect(channelForLedcSignal(87)).toBeNull();
    expect(channelForLedcSignal(256)).toBeNull();
  });
});


describe('SignalRouter — multi-servo blink regression', () => {
  it('two servos on different channels do NOT alias on the reverse index', () => {
    // Exact scenario from user report (project 5218f9e3, solar-tracker):
    // GPIO 13 driven by LEDC HS channel 0 (signal 72),
    // GPIO 12 driven by LEDC HS channel 1 (signal 73).
    const r = new SignalRouter();
    const sigPan = ledcSignalForChannel(0);
    const sigTilt = ledcSignalForChannel(1);
    r.updateRouting(13, sigPan);
    r.updateRouting(12, sigTilt);

    // A duty event on channel 0 (sigPan) routes ONLY to pin 13.
    expect(r.pinsForSignal(sigPan)).toEqual([13]);
    expect(r.pinsForSignal(sigPan)).not.toContain(12);

    // Symmetrically: a duty on channel 1 routes ONLY to pin 12.
    expect(r.pinsForSignal(sigTilt)).toEqual([12]);
    expect(r.pinsForSignal(sigTilt)).not.toContain(13);
  });
});
