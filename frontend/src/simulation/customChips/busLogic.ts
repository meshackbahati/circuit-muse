/**
 * 4-valued logic + drive-strength resolution for chip-to-chip bus nets.
 * Phase 1 of the multi-chip digital bus track (project/multichip-bus/).
 *
 * A real wire is one of four states (the IEEE 4-state model): 0, 1, Z (high
 * impedance / floating / tri-stated), X (unknown — typically two drivers
 * fighting). Phase 0 gave every endpoint of a chip-to-chip net ONE shared key;
 * this module turns the "release the bus by switching to VX_INPUT" idiom that
 * rom-32k/ram-64k/8255 already use into REAL tri-state, so a multi-driver bus
 * (many chips, one data line, only the enabled one drives) resolves correctly.
 *
 * Resolution is by (value, strength), not value alone (01-how-proteus-works.md
 * section 3): strongest driver wins; equal strength + opposite values = X
 * (contention); no real driver = Z (floating); a pull resistor is a `pull`
 * driver that loses to `strong` but beats all-Z.
 *
 * Single-bit by design: a net is one wire. 3vl (packed 0/1/X vectors) is for
 * multi-bit bus values and waveform display in a later phase; bit-level driver
 * resolution needs Z + strength, which 3vl does not model, so it is a small
 * self-contained fold here.
 */

export type V4 = '0' | '1' | 'Z' | 'X';

/** Verilog-style drive strengths — only the few that matter for digital buses. */
export enum Strength {
  HIGHZ = 0, // not driving (a tri-stated / input pin contributes this)
  PULL = 1, // pull-up / pull-down resistor, or INPUT_PULLUP/PULLDOWN
  STRONG = 2, // a normal gate / chip output (the default for VX_OUTPUT)
  SUPPLY = 3, // a hard power / ground rail
}

/** One driver's contribution to a net. `HIGHZ` strength means "not driving". */
export interface Drive {
  value: 0 | 1;
  strength: Strength;
}

export const HIGHZ_DRIVE: Drive = Object.freeze({ value: 0, strength: Strength.HIGHZ });

export interface Resolved {
  v: V4;
  /** Strength of the winning driver(s); HIGHZ when the net is floating (Z). */
  strength: Strength;
}

/**
 * Resolve a net from its drivers' contributions:
 *   - keep the drivers of maximum real strength;
 *   - all agree -> that value at that strength;
 *   - disagree  -> X (contention) at that strength;
 *   - no real driver -> Z at HIGHZ.
 */
export function resolveNet(drives: Iterable<Drive>): Resolved {
  let maxS: Strength = Strength.HIGHZ;
  let val: 0 | 1 | null = null;
  let contention = false;

  for (const d of drives) {
    if (d.strength <= Strength.HIGHZ) continue; // tri-stated: contributes nothing
    if (d.strength > maxS) {
      maxS = d.strength;
      val = d.value;
      contention = false;
    } else if (d.strength === maxS) {
      if (val === null) val = d.value;
      else if (val !== d.value) contention = true;
    }
  }

  if (val === null) return { v: 'Z', strength: Strength.HIGHZ };
  if (contention) return { v: 'X', strength: maxS };
  return { v: val === 1 ? '1' : '0', strength: maxS };
}

// Chip pin modes (mirror ChipInstance MODE_* / velxio-chip.h vx_pin_mode).
const VX_INPUT = 0;
const VX_OUTPUT = 1;
const VX_INPUT_PULLUP = 2;
const VX_INPUT_PULLDOWN = 3;
const VX_ANALOG = 4;
const VX_OUTPUT_LOW = 16;
const VX_OUTPUT_HIGH = 17;

/**
 * Map a chip pin's mode + its last-written level to a bus Drive.
 *   OUTPUT / OUTPUT_LOW / OUTPUT_HIGH -> strong drive of `value`
 *   INPUT_PULLUP -> pull 1 ; INPUT_PULLDOWN -> pull 0
 *   INPUT / ANALOG -> Hi-Z (release the bus)
 * This makes "switch to VX_INPUT" mean "stop driving" — real tri-state for free.
 */
export function modeToDrive(mode: number, value: 0 | 1): Drive {
  switch (mode) {
    case VX_OUTPUT:
    case VX_OUTPUT_LOW:
    case VX_OUTPUT_HIGH:
      return { value, strength: Strength.STRONG };
    case VX_INPUT_PULLUP:
      return { value: 1, strength: Strength.PULL };
    case VX_INPUT_PULLDOWN:
      return { value: 0, strength: Strength.PULL };
    case VX_INPUT:
    case VX_ANALOG:
    default:
      return HIGHZ_DRIVE;
  }
}

/**
 * Project a resolved 4-value onto the boolean PinManager carries. A driven 1 is
 * high; everything else (0, floating Z with no pull, contention X) reads low.
 * Z and X are surfaced separately (see resolveNet) for warnings / diagnostics;
 * callers that care about float-vs-low inspect the V4, not this boolean.
 */
export function resolvedToBool(r: Resolved): boolean {
  return r.v === '1';
}
