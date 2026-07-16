/**
 * Regression test for GitHub issue #122
 * https://github.com/davidmonterocrespo24/velxio/issues/122
 *
 * The user (chenxyzj) reported three sub-problems running MicroPython on ESP32:
 *
 *   1. AttributeError: 'Pin' object has no attribute 'toggle'
 *      → Pin.toggle() was added to the ESP32 port in MicroPython v1.21 (Oct
 *        2023). The firmware Velxio bundles is v1.20.0 (April 2023), so the
 *        default Blink demo crashes immediately.
 *
 *   2. ESP32-C3: "Detected size(2048k) smaller than the size in the binary
 *      image header(4096k). Probe failed."
 *      → padToFlashSize() was forcing a 4 MB minimum only for plain 'esp32',
 *        leaving every other variant (S3, C3, …) padded to 2 MB. Every
 *        official MicroPython ESP32 build is compiled with
 *        CONFIG_ESPTOOLPY_FLASHSIZE_4MB so the SPI flash driver bails out at
 *        boot when the QEMU flash is smaller.
 *
 *   3. WLAN crash on STA_IF connect (LoadStorePIFAddrError) — *not* covered
 *      here. That requires real QEMU and lives in
 *      test/backend/e2e/test_micropython_esp32.mjs as a manual diagnostic.
 *
 * This file contains pure Vitest unit tests — no QEMU, no network, no DOM.
 */

import { describe, it, expect } from 'vitest';
import { padToFlashSize } from '../simulation/Esp32MicroPythonLoader';
import type { BoardKind } from '../types/board';

// ── Synthetic firmware payloads ───────────────────────────────────────────────
//
// Real MicroPython firmware blobs are 1.6+ MB. For these tests we just need a
// payload smaller than 4 MB whose first byte is the ESP32 image magic (0xE9)
// so we can spot-check the placement.
function makeFirmware(bytes: number): Uint8Array {
  const fw = new Uint8Array(bytes).fill(0x00);
  fw[0] = 0xe9; // ESP image magic
  return fw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #122 fix #1 — every ESP32 variant must pad to AT LEAST 4 MB
// ─────────────────────────────────────────────────────────────────────────────

describe('issue #122 — ESP32-C3 flash size mismatch', () => {
  const SIZE_4MB = 4 * 1024 * 1024;
  const SAMPLE_FW = makeFirmware(1_700_000); // ≈ a real MicroPython payload

  // The variants the loader's toFirmwareVariant() routes to each base build
  // (esp32, esp32-s3, esp32-c3). All three groups need ≥ 4 MB.
  const ALL_VARIANTS: BoardKind[] = [
    'esp32',
    'esp32-devkit-c-v4',
    'esp32-cam',
    'wemos-lolin32-lite',
    'esp32-s3',
    'xiao-esp32-s3',
    'arduino-nano-esp32',
    'esp32-c3',
    'xiao-esp32-c3',
    'aitewinrobot-esp32c3-supermini',
  ];

  for (const kind of ALL_VARIANTS) {
    it(`pads ${kind} to ≥ 4 MB`, () => {
      const padded = padToFlashSize(SAMPLE_FW, kind);
      expect(padded.length).toBeGreaterThanOrEqual(SIZE_4MB);
      // Padding goes on the high end — every byte beyond the firmware
      // (and beyond any LX6 0x1000 offset) must be 0xFF.
      const lastByte = padded[padded.length - 1];
      expect(lastByte).toBe(0xff);
    });
  }

  it('regression: ESP32-C3 must NOT pad to only 2 MB (the original bug)', () => {
    const padded = padToFlashSize(SAMPLE_FW, 'esp32-c3');
    // 2 MB is the value that produced the user's
    //   "Detected size(2048k) smaller than the size in the binary image header(4096k)"
    // panic at boot. The fix forces 4 MB.
    expect(padded.length).not.toBe(2 * 1024 * 1024);
    expect(padded.length).toBeGreaterThanOrEqual(SIZE_4MB);
  });

  it('LX6 (esp32) places firmware at flash offset 0x1000 (2nd-stage bootloader)', () => {
    const padded = padToFlashSize(SAMPLE_FW, 'esp32');
    expect(padded[0x1000]).toBe(0xe9);
    // Bytes before 0x1000 are pre-firmware and stay 0xFF (the ROM bootloader
    // reads its own code from the chip, not from flash).
    expect(padded[0]).toBe(0xff);
    expect(padded[0xfff]).toBe(0xff);
  });

  it('S3 / C3 place the combined image at offset 0', () => {
    for (const kind of ['esp32-s3', 'esp32-c3'] as BoardKind[]) {
      const padded = padToFlashSize(SAMPLE_FW, kind);
      expect(padded[0]).toBe(0xe9);
    }
  });

  it('emits exactly one of QEMU\'s valid flash sizes (2/4/8/16 MB)', () => {
    const VALID = [2, 4, 8, 16].map((mb) => mb * 1024 * 1024);
    for (const kind of ALL_VARIANTS) {
      const padded = padToFlashSize(SAMPLE_FW, kind);
      expect(VALID).toContain(padded.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #122 fix #2 — default ESP32 MicroPython demo must NOT use Pin.toggle()
// ─────────────────────────────────────────────────────────────────────────────
//
// Pin.toggle() raises AttributeError on the ESP32 port in v1.20.0 (the
// firmware Velxio ships). We can't import the constant directly from
// useEditorStore.ts (it isn't exported), but we can grep the source.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('issue #122 — default ESP32 MicroPython demo uses portable APIs', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../store/useEditorStore.ts'),
    'utf-8',
  );

  function extractBlock(name: string): string {
    // Match `const NAME = \`...\`;` (template literal across multiple lines).
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\`;`);
    const m = SRC.match(re);
    if (!m) throw new Error(`Could not find ${name} in useEditorStore.ts`);
    return m[1];
  }

  it('DEFAULT_ESP32_MICROPYTHON_CONTENT does not call Pin.toggle()', () => {
    const code = extractBlock('DEFAULT_ESP32_MICROPYTHON_CONTENT');
    // Pin.toggle() is the exact API that raised AttributeError for the user.
    // The fix uses pin.value(bool) which is portable across every MicroPython
    // port and version, so the script must never reference .toggle().
    expect(code).not.toMatch(/\.toggle\(\)/);
  });

  it('DEFAULT_ESP32_MICROPYTHON_CONTENT uses .value() for portability', () => {
    const code = extractBlock('DEFAULT_ESP32_MICROPYTHON_CONTENT');
    expect(code).toMatch(/\.value\(/);
  });

  it('Pico (RP2) demo may keep .toggle() — that port has it since v1.18', () => {
    // The RP2 port's `Pin.toggle()` predates v1.20.0, so the Pico demo can
    // safely keep using it. This test exists so that someone "cleaning up"
    // the Pico demo to match the ESP32 fix knows it isn't required.
    const code = extractBlock('DEFAULT_MICROPYTHON_CONTENT');
    // Either form is fine; we just assert it doesn't fail to import or call
    // an unknown method.
    expect(code).toMatch(/Pin\(25, Pin\.OUT\)/);
  });
});
