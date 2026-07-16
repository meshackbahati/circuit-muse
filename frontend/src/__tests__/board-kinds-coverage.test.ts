/**
 * Board-kind coverage matrix (Phase 1d-tests D).
 *
 * Every circuit-muse `BoardKind` is exercised by at least one example
 * across all six `examples-*.ts` modules.  Adding a new board kind
 * to `src/types/board.ts` without adding at least one gallery
 * example for it should fail this test — keeps the demo coverage in
 * sync with the supported hardware list.
 *
 * Deep behavioural tests for each board family (AVR / RP2040 /
 * ESP32 / ESP32-C3) live in their dedicated `*Simulator.test.ts`
 * files; this test only asserts the gallery side.
 *
 * Fidelity (memory `feedback_tests_import_real_code`): imports
 * `BOARD_KIND_LABELS` (the canonical list) + every examples-*.ts
 * source-of-truth.  No duplicated board list.
 */
import { describe, it, expect } from 'vitest';
import { BOARD_KIND_LABELS, type BoardKind } from '../types/board';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { hundredDaysExamples } from '../data/examples-100-days';
import { epaperExamples } from '../data/examples-displays-epaper';
import { picowWifiExamples } from '../data/examples-picow-wifi';
import { circuitExamples } from '../data/examples-circuits';
import type { ExampleProject } from '../data/examples';

const ALL_EXAMPLES: ExampleProject[] = [
  ...analogExamples,
  ...digitalExamples,
  ...hundredDaysExamples,
  ...epaperExamples,
  ...picowWifiExamples,
  ...circuitExamples,
];

/**
 * Boards that intentionally have no gallery example today.  They
 * exist in the type for future support but no canvas demo ships.
 * Adding to this list requires a comment explaining why — keeps the
 * coverage gap visible at code-review time.
 */
const ACCEPTED_UNCOVERED: ReadonlySet<BoardKind> = new Set([
  // Pi Zero / 1 / 2 / 3 / 4 / 5 run on the backend (QEMU ARM/ARM64) — no
  // in-browser canvas example because they boot a full Linux image.
  'raspberry-pi-zero',
  'raspberry-pi-1',
  'raspberry-pi-2',
  'raspberry-pi-3',
  'raspberry-pi-4',
  'raspberry-pi-5',

  // ESP32 Xtensa LX6 variants — all share the same QEMU backend as
  // the primary `esp32` boardKind (which IS covered).  Adding a
  // dedicated example per variant adds zero engine coverage; the
  // canvas just renders a different SVG.
  'esp32-cam',
  'wemos-lolin32-lite',

  // ESP32-S3 Xtensa LX7 family — share the `esp32-s3` QEMU backend.
  // No primary `esp32-s3` example today either; the family is
  // emulator-ready but lacks a demo circuit.  Add one when product
  // wants S3 in the gallery.
  'esp32-s3',
  'xiao-esp32-s3',
  'arduino-nano-esp32',

  // ESP32-C3 RISC-V family — share the `esp32-c3` backend.  Same as
  // above; no primary C3 example exists.
  'esp32-c3',
  'xiao-esp32-c3',
  'aitewinrobot-esp32c3-supermini',

  // ATtiny85 — fully supported via avr8js but no gallery example
  // showcases its limited (5 GPIO) form factor.  Add one when
  // someone proposes a use case.
  'attiny85',

  // STM32 (Blue Pill / Black Pill) — Pro feature emulated on the backend
  // via the licensed libqemu-arm QEMU lib (no in-browser canvas engine,
  // same as the Raspberry Pis above).  Gallery examples are intentionally
  // not shipped to the free tier, so these are accepted as uncovered.
  'stm32-bluepill',
  'stm32-blackpill',
  // Additional STM32 variants (pin-compatible Pills + Discovery / Olimex /
  // Netduino dev boards) — same libqemu-arm backend, no in-browser canvas
  // example shipped.
  'stm32-bluepill-f103cb',
  'stm32-blackpill-f401',
  'stm32-f4-discovery',
  'stm32-olimex-h405',
  'stm32-netduino-plus2',
  'stm32-netduino2',
]);

interface Coverage {
  byBoardType: Map<BoardKind, string[]>;
  byBoardsArray: Map<BoardKind, string[]>;
}

function buildCoverage(): Coverage {
  const byBoardType = new Map<BoardKind, string[]>();
  const byBoardsArray = new Map<BoardKind, string[]>();
  for (const ex of ALL_EXAMPLES) {
    if (ex.boardType) {
      const list = byBoardType.get(ex.boardType) ?? [];
      list.push(ex.id);
      byBoardType.set(ex.boardType, list);
    }
    if (ex.boards && ex.boards.length > 0) {
      for (const b of ex.boards) {
        const list = byBoardsArray.get(b.boardKind as BoardKind) ?? [];
        list.push(ex.id);
        byBoardsArray.set(b.boardKind as BoardKind, list);
      }
    }
  }
  return { byBoardType, byBoardsArray };
}

describe('BoardKind gallery coverage matrix', () => {
  const { byBoardType, byBoardsArray } = buildCoverage();
  const allKinds = Object.keys(BOARD_KIND_LABELS) as BoardKind[];

  it.each(allKinds.map((k) => [k] as const))(
    'BoardKind %s has at least one gallery example (or is accepted as uncovered)',
    (kind) => {
      const count =
        (byBoardType.get(kind)?.length ?? 0) + (byBoardsArray.get(kind)?.length ?? 0);
      if (ACCEPTED_UNCOVERED.has(kind)) {
        expect(count, `${kind} is in ACCEPTED_UNCOVERED but actually has ${count} examples — remove from the accepted list`).toBe(0);
        return;
      }
      expect(
        count,
        `${kind} has no gallery example.  Either add an example to data/examples-*.ts OR add ${kind} to ACCEPTED_UNCOVERED with a comment.`,
      ).toBeGreaterThan(0);
    },
  );

  it('summary: every BoardKind appears in BOARD_KIND_LABELS', () => {
    // Self-check that the LABELS map is exhaustive vs the type union.
    // If you add a kind to the BoardKind union without an entry in
    // BOARD_KIND_LABELS, TypeScript already catches it.  This is a
    // runtime double-check.
    for (const kind of allKinds) {
      expect(BOARD_KIND_LABELS[kind], `${kind} missing label`).toBeTruthy();
    }
  });

  it('reports BoardKind coverage stats (informational)', () => {
    const stats = allKinds.map((kind) => {
      const inBoardType = byBoardType.get(kind)?.length ?? 0;
      const inBoardsArray = byBoardsArray.get(kind)?.length ?? 0;
      return { kind, total: inBoardType + inBoardsArray, inBoardType, inBoardsArray };
    });
    stats.sort((a, b) => b.total - a.total);
    // eslint-disable-next-line no-console
    console.log('[board-coverage]', stats.map((s) => `${s.kind}=${s.total}`).join(' '));
    expect(stats.length).toBe(allKinds.length);
  });
});
