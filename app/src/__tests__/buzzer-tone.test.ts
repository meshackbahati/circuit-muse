/**
 * Buzzer sound decisions. The pitch must follow the pin's real toggle rate in
 * simulated time, a pin held HIGH must beep, and LOW must be silent (the old
 * buzzer kept sounding after digitalWrite(LOW)).
 */
import { describe, expect, it } from 'vitest';
import { ACTIVE_BUZZER_HZ, PWM_DEFAULT_HZ, ToneTracker } from '../simulation/audio/toneTracker';

/** Feed a square wave of `hz` for `cycles` periods starting at sim time 0. */
function feedSquare(t: ToneTracker, hz: number, cycles: number, wallMs = 0) {
  const periodMs = 1000 / hz;
  for (let i = 0; i < cycles; i++) {
    t.edge(true, i * periodMs, wallMs);
    t.edge(false, i * periodMs + periodMs / 2, wallMs);
  }
}

describe('ToneTracker', () => {
  it('measures tone() pitch from simulated edge timing', () => {
    const t = new ToneTracker();
    feedSquare(t, 1000, 10);
    const d = t.decide(0);
    expect(d.kind).toBe('tone');
    expect(d.kind === 'tone' && d.frequency).toBeCloseTo(1000, 0);
  });

  it('keeps the simulated pitch even when edges arrive slowly in real time', () => {
    const t = new ToneTracker();
    // 440 Hz in simulated time, but all edges land within the same wall ms.
    feedSquare(t, 440, 8, 1234);
    const d = t.decide(1234);
    expect(d.kind === 'tone' && Math.round(d.frequency)).toBe(440);
  });

  it('stops the tone once edges stop and the pin is LOW', () => {
    const t = new ToneTracker();
    feedSquare(t, 2000, 10, 0);
    expect(t.decide(50).kind).toBe('tone');
    expect(t.decide(500)).toEqual({ kind: 'silent' });
  });

  it('beeps like an active buzzer while the pin is held HIGH', () => {
    const t = new ToneTracker();
    t.edge(true, 0, 0);
    expect(t.decide(10)).toEqual({ kind: 'tone', frequency: ACTIVE_BUZZER_HZ });
    t.edge(false, 500, 600);
    expect(t.decide(610)).toEqual({ kind: 'silent' });
  });

  it('treats slow toggling (beep every half second) as on/off beeps', () => {
    const t = new ToneTracker();
    t.edge(true, 0, 0);
    t.edge(false, 500, 500);
    t.edge(true, 1000, 1000);
    expect(t.decide(1000)).toEqual({ kind: 'tone', frequency: ACTIVE_BUZZER_HZ });
  });

  it('plays analogWrite PWM at the Arduino PWM rate and full duty as a beep', () => {
    const t = new ToneTracker();
    t.setPwmDuty(0.5);
    expect(t.decide(0)).toEqual({ kind: 'tone', frequency: PWM_DEFAULT_HZ });
    t.setPwmDuty(1);
    expect(t.decide(0)).toEqual({ kind: 'tone', frequency: ACTIVE_BUZZER_HZ });
    t.setPwmDuty(0);
    expect(t.decide(0)).toEqual({ kind: 'silent' });
  });

  it('follows level changes from boards without timed events', () => {
    const t = new ToneTracker();
    t.setLevel(true);
    expect(t.decide(0).kind).toBe('tone');
    t.setLevel(false);
    expect(t.decide(0).kind).toBe('silent');
  });
});
