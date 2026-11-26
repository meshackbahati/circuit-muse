import { describe, expect, it } from 'vitest';
import { channelHints, chooseChannelPin } from '../utils/oscilloscopeChannelHints';

describe('oscilloscope channel hints', () => {
  it('finds the built-in LED pin in a blink sketch', () => {
    const hints = channelHints(`
      void setup() { pinMode(LED_BUILTIN, OUTPUT); }
      void loop() {
        digitalWrite(LED_BUILTIN, HIGH);
        delay(1000);
        digitalWrite(LED_BUILTIN, LOW);
        delay(1000);
      }
    `);
    expect(hints.pins).toEqual([13]);
    expect(hints.timeDivMs).toBe(100);
  });

  it('finds numeric output pins and ignores commented-out writes', () => {
    const hints = channelHints(`
      // digitalWrite(7, HIGH);
      void loop() { digitalWrite(9, HIGH); analogWrite(5, 128); }
    `);
    expect(hints.pins).toEqual([9, 5]);
    expect(hints.timeDivMs).toBeNull();
  });

  it('prefers a written pin over an arbitrary wired pin', () => {
    expect(chooseChannelPin([0, 1, 9, 13], new Set(['0']), [9])).toBe(9);
  });

  it('falls back to pin 13 before pin 0 when the sketch gives no hint', () => {
    expect(chooseChannelPin([0, 1, 9, 13], new Set(), [])).toBe(13);
  });

  it('honours wired pins when they are also written', () => {
    expect(chooseChannelPin([0, 1, 9, 13], new Set(['D9']), [9, 13])).toBe(9);
  });
});
