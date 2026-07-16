/**
 * circuitVerifier — unit tests against hand-crafted netlists that
 * deliberately violate each safety rule.
 *
 * Each test feeds the verifier the *normalised* shape that the live store
 * already uses (components + wires arrays), runs an actual ngspice solve,
 * and asserts that the right warning code surfaces.
 */
import { describe, it, expect } from 'vitest';
import { verifyCircuit } from '../simulation/verify/circuitVerifier';
import type { BuildNetlistInput } from '../simulation/spice/types';

// ── Building blocks ──────────────────────────────────────────────────────

function pwr(id = 'src', volts = 5): BuildNetlistInput['components'][number] {
  return {
    id,
    metadataId: 'signal-generator',
    properties: { waveform: 'dc', offset: volts, amplitude: 0, frequency: 1 },
  };
}

function res(id: string, ohms: string): BuildNetlistInput['components'][number] {
  return { id, metadataId: 'resistor', properties: { value: ohms } };
}

function led(id: string, color = 'red'): BuildNetlistInput['components'][number] {
  return { id, metadataId: 'led', properties: { color } };
}

function w(
  id: string,
  from: [string, string],
  to: [string, string],
): BuildNetlistInput['wires'][number] {
  return {
    id,
    start: { componentId: from[0], pinName: from[1] },
    end: { componentId: to[0], pinName: to[1] },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('verifyCircuit — clean circuits report no errors', () => {
  it(
    'a 220Ω + red LED across 5 V is fine',
    { timeout: 30_000 },
    async () => {
      const input: BuildNetlistInput = {
        components: [pwr('src'), res('r1', '220'), led('led1')],
        wires: [
          w('w1', ['src', 'SIG'], ['r1', '1']),
          w('w2', ['r1', '2'], ['led1', 'A']),
          w('w3', ['led1', 'C'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input);
      expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
      // No "led-no-current" warning either — 5V/220Ω is well above µA.
      expect(
        result.warnings.filter((w) => w.code !== 'solver-failed'),
      ).toEqual([]);
    },
  );
});

describe('verifyCircuit — short circuit detection', () => {
  it(
    'fires an error when 5V is wired straight to GND',
    { timeout: 30_000 },
    async () => {
      // Even with ESR-zero this represents a dead short — SPICE pushes huge
      // current through the source. Use a tiny series R so SPICE doesn't
      // produce a singular matrix, but well below 1Ω.
      const input: BuildNetlistInput = {
        components: [pwr('src'), res('rShort', '0.01')],
        wires: [
          w('w1', ['src', 'SIG'], ['rShort', '1']),
          w('w2', ['rShort', '2'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input);
      const codes = result.errors.map((e) => e.code);
      expect(codes, JSON.stringify(result.errors)).toContain('short-circuit');
    },
  );
});

describe('verifyCircuit — LED overcurrent', () => {
  it(
    'fires an error when an LED is wired with too small a series resistor',
    { timeout: 30_000 },
    async () => {
      // 5V → 10Ω → LED (Vf ≈ 2V) → GND.  I ≈ (5-2)/10 = 300 mA — well above
      // the 20 mA absolute maximum.
      const input: BuildNetlistInput = {
        components: [pwr('src'), res('r1', '10'), led('led1')],
        wires: [
          w('w1', ['src', 'SIG'], ['r1', '1']),
          w('w2', ['r1', '2'], ['led1', 'A']),
          w('w3', ['led1', 'C'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input);
      const codes = result.errors.map((e) => e.code);
      expect(codes, JSON.stringify(result.errors)).toContain('led-overcurrent');
      // The LED itself should be tagged.
      const ledErr = result.errors.find((e) => e.code === 'led-overcurrent');
      expect(ledErr?.componentId).toBe('led1');
    },
  );
});

describe('verifyCircuit — resistor over-power', () => {
  it(
    'fires a warning when a small resistor across 5 V dissipates too much',
    { timeout: 30_000 },
    async () => {
      // 5V across 10Ω → I = 0.5 A → P = 2.5 W. Way past the 1/4 W default.
      const input: BuildNetlistInput = {
        components: [pwr('src'), res('rHot', '10')],
        wires: [
          w('w1', ['src', 'SIG'], ['rHot', '1']),
          w('w2', ['rHot', '2'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input);
      const warnCodes = result.warnings.map((e) => e.code);
      // Resistor over-power is a non-blocking warning (real-world physical
      // concern, not a sim error). Short-circuit and other safety issues
      // still hit `errors`.
      expect(warnCodes, JSON.stringify(result.warnings)).toContain('resistor-overpower');
    },
  );

  it(
    'respects a custom power property on the resistor',
    { timeout: 30_000 },
    async () => {
      // 5V across 10Ω with explicit 5W rating → no overpower warning.
      const r: BuildNetlistInput['components'][number] = {
        id: 'rBig',
        metadataId: 'resistor',
        properties: { value: '10', power: 5 },
      };
      const input: BuildNetlistInput = {
        components: [pwr('src'), r],
        wires: [
          w('w1', ['src', 'SIG'], ['rBig', '1']),
          w('w2', ['rBig', '2'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input);
      const overpowerErr = result.errors.find((e) => e.code === 'resistor-overpower');
      const overpowerWarn = result.warnings.find((e) => e.code === 'resistor-overpower');
      expect(overpowerErr, JSON.stringify(result.errors)).toBeUndefined();
      expect(overpowerWarn, JSON.stringify(result.warnings)).toBeUndefined();
    },
  );
});

describe('verifyCircuit — threshold overrides', () => {
  it(
    'bumping shortCircuitAmps suppresses the short-circuit error',
    { timeout: 30_000 },
    async () => {
      const input: BuildNetlistInput = {
        components: [pwr('src'), res('rShort', '0.01')],
        wires: [
          w('w1', ['src', 'SIG'], ['rShort', '1']),
          w('w2', ['rShort', '2'], ['src', 'GND']),
        ],
        boards: [],
        analysis: { kind: 'op' },
      };
      const result = await verifyCircuit(input, { shortCircuitAmps: 1000 });
      const codes = result.errors.map((e) => e.code);
      expect(codes).not.toContain('short-circuit');
    },
  );
});

// ── Sanity: shipping examples never trigger errors ─────────────────────────
// If any gallery example produces a verifier error, that's a bug in the
// example itself. Loop a handful of representative ones to catch
// regressions early.
import { digitalExamples } from '../data/examples-digital';
import { analogExamples } from '../data/examples-analog';

function toInput(ex: { components: any[]; wires: any[] }): BuildNetlistInput {
  return {
    components: ex.components.map((c: any) => ({
      id: c.id,
      metadataId: c.type.replace(/^(wokwi|velxio)-/, ''),
      properties: c.properties ?? {},
    })),
    wires: ex.wires.map((wire: any) => ({
      id: wire.id,
      start: { componentId: wire.start.componentId, pinName: wire.start.pinName },
      end: { componentId: wire.end.componentId, pinName: wire.end.pinName },
    })),
    boards: [],
    analysis: { kind: 'op' },
  };
}

describe('verifyCircuit — shipping gallery examples are clean', () => {
  it(
    'every digital example passes pre-flight verification',
    { timeout: 180_000 },
    async () => {
      const failures: string[] = [];
      for (const ex of digitalExamples) {
        const result = await verifyCircuit(toInput(ex));
        if (result.errors.length > 0) {
          failures.push(
            `${ex.id}: ${result.errors.map((e) => `${e.code}(${e.componentId ?? '-'})`).join(', ')}`,
          );
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    },
  );

  it(
    'every analog example passes pre-flight verification',
    { timeout: 180_000 },
    async () => {
      const failures: string[] = [];
      for (const ex of analogExamples) {
        const result = await verifyCircuit(toInput(ex));
        if (result.errors.length > 0) {
          failures.push(
            `${ex.id}: ${result.errors.map((e) => `${e.code}(${e.componentId ?? '-'})`).join(', ')}`,
          );
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    },
  );
});
