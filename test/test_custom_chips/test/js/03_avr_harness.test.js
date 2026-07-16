import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AVRHarness } from '../../src/AVRHarness.js';

const HEX = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/blink.hex'),
  'utf8',
);

describe('AVRHarness — boots a real Arduino blink sketch', () => {
  it('toggles pin 13 multiple times in 2 simulated seconds', () => {
    const avr = new AVRHarness();
    avr.load(HEX);
    const states = [];
    avr.onPinChange(13, (s) => states.push(s));
    avr.runCycles(16_000_000 * 2);
    expect(states.length).toBeGreaterThan(2);
    expect(states.some((s) => s === 1)).toBe(true);
    expect(states.some((s) => s === 0)).toBe(true);
  });

  it('PinManager mirrors the bit-level PORTB updates', () => {
    const avr = new AVRHarness();
    avr.load(HEX);
    const transitions = [];
    avr.pinManager.onPinChange(13, (_p, s) => transitions.push(s));
    avr.runCycles(16_000_000); // 1 second
    expect(transitions.length).toBeGreaterThan(0);
  });
});
