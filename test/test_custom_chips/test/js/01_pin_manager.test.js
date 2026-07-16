import { describe, it, expect } from 'vitest';
import { PinManager } from '../../src/PinManager.js';

describe('PinManager — Velxio mirror', () => {
  it('updatePort fires per-bit listeners with mapped Arduino pin numbers', () => {
    const pm = new PinManager();
    const events = [];
    pm.onPinChange(13, (pin, state) => events.push({ pin, state }));
    pm.onPinChange(8,  (pin, state) => events.push({ pin, state }));

    // PORTB bit 5 = pin 13, bit 0 = pin 8
    pm.updatePort('PORTB', 0b00100001, 0b00000000);

    expect(events).toEqual([
      { pin: 8,  state: true },
      { pin: 13, state: true },
    ]);
  });

  it('triggerPinChange skips no-op transitions', () => {
    const pm = new PinManager();
    const fired = [];
    pm.onPinChange(7, (_p, s) => fired.push(s));
    pm.triggerPinChange(7, true);
    pm.triggerPinChange(7, true);  // duplicate — must not refire
    pm.triggerPinChange(7, false);
    expect(fired).toEqual([true, false]);
  });

  it('PWM listener receives duty cycle 0..1', () => {
    const pm = new PinManager();
    const samples = [];
    pm.onPwmChange(9, (_p, duty) => samples.push(duty));
    pm.updatePwm(9, 0.0);
    pm.updatePwm(9, 0.5);
    pm.updatePwm(9, 1.0);
    expect(samples).toEqual([0.0, 0.5, 1.0]);
    expect(pm.getPwmValue(9)).toBe(1.0);
  });

  it('analog listener receives injected voltage', () => {
    const pm = new PinManager();
    const v = [];
    pm.onAnalogChange(14, (_p, vol) => v.push(vol));
    pm.setAnalogVoltage(14, 2.5);
    pm.setAnalogVoltage(14, 4.7);
    expect(v).toEqual([2.5, 4.7]);
  });

  it('unsubscribe removes listener', () => {
    const pm = new PinManager();
    let count = 0;
    const off = pm.onPinChange(2, () => count++);
    pm.triggerPinChange(2, true);
    off();
    pm.triggerPinChange(2, false);
    expect(count).toBe(1);
  });
});
