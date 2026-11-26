/**
 * Direct tests for the wiring audit. These use plain data rather than the
 * canvas so the pin-name table can be checked without a browser: a wrong
 * required pin (for example GND on a NeoPixel, whose supply pin is VSS)
 * would otherwise refuse to compile a correctly wired circuit.
 */
import { describe, expect, it } from 'vitest';
import { auditWiring, type WiringAuditInput } from '../agent/wiringAudit';

const board = { id: 'b1', boardKind: 'arduino-uno' };

function circuit(
  components: Array<{ id: string; metadataId: string }>,
  wires: Array<[string, string, string, string]>,
): WiringAuditInput {
  return {
    boards: [board],
    components,
    wires: wires.map(([from, fromPin, to, toPin], index) => ({
      id: `w${index}`,
      start: { componentId: from, pinName: fromPin },
      end: { componentId: to, pinName: toPin },
    })),
  };
}

describe('auditWiring', () => {
  it('accepts a complete LED circuit with a series resistor', () => {
    const result = auditWiring(
      circuit(
        [
          { id: 'r1', metadataId: 'resistor' },
          { id: 'd1', metadataId: 'led' },
        ],
        [
          ['b1', '5V', 'r1', '1'],
          ['r1', '2', 'd1', 'A'],
          ['d1', 'C', 'b1', 'GND'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
    expect(result.blocking_issues).toEqual([]);
  });

  it('rejects an LED with only the anode wired', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'd1', metadataId: 'led' }],
        [['b1', 'D9', 'd1', 'A']],
      ),
    );
    expect(result.complete).toBe(false);
    expect(result.incomplete_components[0]?.missing_pins).toContain('C');
  });

  it('accepts an RGB LED wired on all four pins', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'rgb1', metadataId: 'rgb-led' }],
        [
          ['b1', 'GND', 'rgb1', 'COM'],
          ['b1', 'D9', 'rgb1', 'R'],
          ['b1', 'D10', 'rgb1', 'G'],
          ['b1', 'D11', 'rgb1', 'B'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('accepts a NeoPixel on VDD, VSS and DIN', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'n1', metadataId: 'neopixel' }],
        [
          ['b1', '5V', 'n1', 'VDD'],
          ['b1', 'GND', 'n1', 'VSS'],
          ['b1', 'D6', 'n1', 'DIN'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('accepts a 74HC595 on its real pin names', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'u1', metadataId: '74hc595' }],
        [
          ['b1', '5V', 'u1', 'VCC'],
          ['b1', 'GND', 'u1', 'GND'],
          ['b1', 'D11', 'u1', 'DS'],
          ['b1', 'D13', 'u1', 'SHCP'],
          ['b1', 'D10', 'u1', 'STCP'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('accepts a microSD card on DI and DO rather than MOSI and MISO', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'sd1', metadataId: 'microsd-card' }],
        [
          ['b1', '5V', 'sd1', 'VCC'],
          ['b1', 'GND', 'sd1', 'GND'],
          ['b1', 'D13', 'sd1', 'SCK'],
          ['b1', 'D10', 'sd1', 'CS'],
          ['b1', 'D11', 'sd1', 'DI'],
          ['b1', 'D12', 'sd1', 'DO'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('accepts a DS1307 on its 5V pin', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'rtc1', metadataId: 'ds1307' }],
        [
          ['b1', '5V', 'rtc1', '5V'],
          ['b1', 'GND', 'rtc1', 'GND'],
          ['b1', 'A4', 'rtc1', 'SDA'],
          ['b1', 'A5', 'rtc1', 'SCL'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('accepts a slide switch wired on common and either throw', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'sw1', metadataId: 'slide-switch' }],
        [
          ['b1', 'D2', 'sw1', '2'],
          ['b1', 'GND', 'sw1', '3'],
        ],
      ),
    );
    expect(result.complete).toBe(true);
  });

  it('rejects a pushbutton wired on only one contact side', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'btn1', metadataId: 'pushbutton' }],
        [
          ['b1', 'D2', 'btn1', '1.l'],
          ['b1', 'GND', 'btn1', '2.l'],
        ],
      ),
    );
    expect(result.complete).toBe(false);
    expect(result.blocking_issues.some((issue) => /one contact side/.test(issue.reason))).toBe(true);
  });

  it('rejects a board that shares signals but not ground', () => {
    const result = auditWiring(
      circuit(
        [{ id: 'd1', metadataId: 'led' }],
        [
          ['b1', 'D9', 'd1', 'A'],
          ['d1', 'C', 'b1', 'D8'],
        ],
      ),
    );
    expect(result.complete).toBe(false);
    expect(result.boards_without_ground).toContain('b1');
  });
});
