/**
 * Phase 1 — 4-valued logic + drive-strength resolution (project/multichip-bus/).
 * Covers the exit criteria from 03-phases.md: a shared net with a pull-up and
 * two tri-state drivers resolves to 0/1/Z/X per the rules; contention -> X.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveNet,
  modeToDrive,
  resolvedToBool,
  Strength,
  HIGHZ_DRIVE,
  type Drive,
} from '../simulation/customChips/busLogic';

const strong = (v: 0 | 1): Drive => ({ value: v, strength: Strength.STRONG });
const pull = (v: 0 | 1): Drive => ({ value: v, strength: Strength.PULL });
const supply = (v: 0 | 1): Drive => ({ value: v, strength: Strength.SUPPLY });

describe('busLogic — resolveNet', () => {
  it('no drivers -> Z (floating)', () => {
    expect(resolveNet([]).v).toBe('Z');
    expect(resolveNet([HIGHZ_DRIVE, HIGHZ_DRIVE]).v).toBe('Z');
  });

  it('a single strong driver wins', () => {
    expect(resolveNet([strong(1)]).v).toBe('1');
    expect(resolveNet([strong(0)]).v).toBe('0');
  });

  it('any real driver overrides Z', () => {
    expect(resolveNet([strong(1), HIGHZ_DRIVE, HIGHZ_DRIVE]).v).toBe('1');
  });

  it('strong beats pull', () => {
    expect(resolveNet([strong(0), pull(1)]).v).toBe('0');
    expect(resolveNet([pull(0), strong(1)]).v).toBe('1');
  });

  it('a lone pull resistor wins over all-Z (floating bus reads the pull)', () => {
    expect(resolveNet([pull(1), HIGHZ_DRIVE, HIGHZ_DRIVE]).v).toBe('1');
    expect(resolveNet([pull(0)]).v).toBe('0');
  });

  it('supply beats strong', () => {
    expect(resolveNet([supply(1), strong(0)]).v).toBe('1');
  });

  it('two strong drivers that agree -> that value (no contention)', () => {
    expect(resolveNet([strong(1), strong(1)]).v).toBe('1');
  });

  it('two strong drivers that disagree -> X (contention)', () => {
    const r = resolveNet([strong(0), strong(1)]);
    expect(r.v).toBe('X');
    expect(r.strength).toBe(Strength.STRONG);
  });

  it('reports the winning strength', () => {
    expect(resolveNet([pull(1)]).strength).toBe(Strength.PULL);
    expect(resolveNet([strong(1)]).strength).toBe(Strength.STRONG);
    expect(resolveNet([]).strength).toBe(Strength.HIGHZ);
  });

  // The Phase 1 exit scenario: a data bus with a pull-up + two tri-state drivers.
  it('tri-state bus: only the enabled driver drives; releasing falls to the pull-up', () => {
    const pullup = pull(1);
    // Driver A enabled to 0, driver B released -> bus reads 0.
    expect(resolveNet([pullup, strong(0), HIGHZ_DRIVE]).v).toBe('0');
    // Both drivers released -> bus floats up to the pull-up -> 1.
    expect(resolveNet([pullup, HIGHZ_DRIVE, HIGHZ_DRIVE]).v).toBe('1');
    // Both drivers enabled to OPPOSITE values -> contention -> X.
    expect(resolveNet([pullup, strong(0), strong(1)]).v).toBe('X');
  });
});

describe('busLogic — modeToDrive', () => {
  it('outputs drive strong at their value', () => {
    expect(modeToDrive(1 /* OUTPUT */, 1)).toEqual({ value: 1, strength: Strength.STRONG });
    expect(modeToDrive(16 /* OUTPUT_LOW */, 0)).toEqual({ value: 0, strength: Strength.STRONG });
    expect(modeToDrive(17 /* OUTPUT_HIGH */, 1)).toEqual({ value: 1, strength: Strength.STRONG });
  });

  it('plain input / analog release the bus (Hi-Z)', () => {
    expect(modeToDrive(0 /* INPUT */, 1).strength).toBe(Strength.HIGHZ);
    expect(modeToDrive(4 /* ANALOG */, 0).strength).toBe(Strength.HIGHZ);
  });

  it('pull-up / pull-down contribute a pull-strength level', () => {
    expect(modeToDrive(2 /* INPUT_PULLUP */, 0)).toEqual({ value: 1, strength: Strength.PULL });
    expect(modeToDrive(3 /* INPUT_PULLDOWN */, 1)).toEqual({ value: 0, strength: Strength.PULL });
  });
});

describe('busLogic — resolvedToBool', () => {
  it('only a driven 1 is high; 0/Z/X read low', () => {
    expect(resolvedToBool(resolveNet([strong(1)]))).toBe(true);
    expect(resolvedToBool(resolveNet([strong(0)]))).toBe(false);
    expect(resolvedToBool(resolveNet([]))).toBe(false); // Z
    expect(resolvedToBool(resolveNet([strong(0), strong(1)]))).toBe(false); // X
  });
});
