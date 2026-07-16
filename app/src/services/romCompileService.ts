/**
 * Frontend wrapper for POST /api/compile-rom — compiles a chip-program file
 * (8080 ASM, Intel HEX, raw .bin) into base64 ROM bytes that get stored on
 * a custom-chip component's `romBytes` property. The chip's emulator then
 * reads those bytes at chip_setup via vx_rom_size / vx_rom_read.
 */

export type RomTarget = '8080' | 'z80' | '8086' | '4004';
export type RomFormat = 'asm' | 'hex' | 'bin' | 'c';

export interface RomCompileResult {
  success: boolean;
  rom_base64: string | null;
  byte_size: number;
  stderr: string;
  error: string | null;
}

const BASE = '/api/compile-rom';

export async function compileRom(
  source: string,
  target: RomTarget,
  format: RomFormat,
): Promise<RomCompileResult> {
  const res = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ source, target, format }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      rom_base64: null,
      byte_size: 0,
      stderr: '',
      error: `HTTP ${res.status}: ${text}`,
    };
  }
  return (await res.json()) as RomCompileResult;
}

/** Classify a filename as a chip-program file (vs an Arduino sketch).
 *
 * `.c` is intentionally NOT in the always-list — Arduino sketches use .c
 * too. The toolbar disambiguates by checking whether a custom-chip on
 * the canvas has `programFile === activeFile.name`. If yes, .c is a chip
 * program (SDCC route); if no, it's an Arduino sketch (arduino-cli route).
 */
export function isChipProgramFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.s') ||
    lower.endsWith('.asm') ||
    lower.endsWith('.hex') ||
    lower.endsWith('.bin')
  );
}

/** Pick a sensible compile format from the filename extension. */
export function formatForFile(name: string): RomFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.hex')) return 'hex';
  if (lower.endsWith('.bin')) return 'bin';
  if (lower.endsWith('.c') || lower.endsWith('.cpp')) return 'c';
  return 'asm';
}

/** Pick the right target CPU from the chip's chip.json programTargets,
 *  falling back to 8080 (the only one wired up today). */
export function targetForChip(chipJsonStr: string): RomTarget {
  try {
    const obj = JSON.parse(chipJsonStr);
    if (Array.isArray(obj.programTargets) && obj.programTargets.length > 0) {
      const t = String(obj.programTargets[0]).toLowerCase();
      if (t === '8080' || t === 'z80' || t === '8086' || t === '4004') return t;
    }
  } catch { /* ignore */ }
  return '8080';
}

/**
 * A custom chip is "programmable" — it runs a user program / ROM, like a CPU
 * emulator — when its chip.json declares `programTargets`, or it already
 * references a program file. Behaviour / driver chips (a servo driver, a
 * sensor) declare no programTargets and are edited only in the chip designer.
 *
 * This (not `programFile`) is the canonical predicate: a chip dropped fresh
 * from the gallery has an empty programFile until we seed one, but its
 * chip.json already says it's a CPU.
 */
export function isProgrammableChip(
  props: Record<string, unknown> | null | undefined,
): boolean {
  if (!props) return false;
  if (String(props.programFile ?? '').trim()) return true;
  try {
    const obj = JSON.parse(String(props.chipJson ?? '{}'));
    return Array.isArray(obj.programTargets) && obj.programTargets.length > 0;
  } catch {
    return false;
  }
}

/** Default editable program file name for a freshly-added programmable chip.
 *  We seed C — SDCC compiles it to the chip's CPU (z80 / 8080 / ...). */
export const DEFAULT_CHIP_PROGRAM_FILE = 'program.c';

/**
 * Starter C program seeded into a newly-added programmable chip's editor
 * group, so the chip has an editable program from the moment it lands on the
 * canvas. Walks a single LED across the 8 memory-mapped outputs — it compiles
 * and does something visible on Run. Mirrors the working chaser.c idiom
 * (volatile MMIO pointer + nop-based delay; SDCC treats plain `char` as
 * unsigned on these CPUs, so the pattern uses an explicit unsigned byte).
 */
export const DEFAULT_CHIP_PROGRAM_C = `/* Program for the programmable CPU chip — compiled by SDCC and loaded as the
 * chip's ROM. Memory-mapped I/O matches the z80-cpu / i8080-cpu map:
 *
 *     0xC000  LED_OUT   write: bit i drives output pin LEDi
 *     0xC003  BTN_IN    read:  bit i reads input pin BTNi
 *
 * Edit this and click Run. (Rename to .s to write assembly instead.)
 */
#define LED_OUT  (*(volatile unsigned char *)0xC000)
#define BTN_IN   (*(volatile unsigned char *)0xC003)

static void delay(unsigned int loops) {
    while (loops--) {
        __asm
        nop
        __endasm;
    }
}

void main(void) {
    unsigned char bit = 0x01;
    while (1) {
        LED_OUT = bit;             /* light one LED */
        delay(5000);
        bit <<= 1;                 /* walk it left */
        if (bit == 0) bit = 0x01;  /* wrap around */
    }
}
`;
