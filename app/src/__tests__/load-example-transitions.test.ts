// @vitest-environment jsdom
/**
 * Regression test for the bug where switching between a board-less example
 * (analog / digital SPICE-only) and a board-based example (Arduino Uno) left
 * the editor showing the OLD file's content (or nothing at all).
 *
 * Root cause: `loadExample.ts` single-board path called
 * `useEditorStore.setCode()`, which writes to whatever file `activeFileId`
 * happens to point at. But after a board-less example removed every board,
 * its file group was deleted — and `activeFileId` still pointed at the now-
 * orphan ID, so `setCode` was a silent no-op against the freshly-recreated
 * Arduino file group.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/useEditorStore';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useElectricalStore } from '../store/useElectricalStore';
import { loadExample } from '../utils/loadExample';
import { exampleProjects, type ExampleProject } from '../data/examples';
import { isProgrammableChip } from '../services/romCompileService';

function resetStores() {
  // Clear all boards completely (also clears the file groups they own).
  const sim = useSimulatorStore.getState();
  const ids = sim.boards.map((b) => b.id);
  for (const id of ids) sim.removeBoard(id);
  useElectricalStore.getState().setPaused(false);
}

function findExample(id: string) {
  const e = exampleProjects.find((x) => x.id === id);
  if (!e) throw new Error(`Example not found: ${id}`);
  return e;
}

function activeSketchContent(): string | undefined {
  const { files, activeFileId } = useEditorStore.getState();
  return files.find((f) => f.id === activeFileId)?.content;
}

describe('loadExample — board-less → board-based transition', () => {
  beforeEach(() => {
    resetStores();
  });

  it('loads Arduino Uno code into the editor after a board-less ANALOG example', async () => {
    // 1. Board-less analog circuit
    await loadExample(findExample('an-voltage-divider'));
    expect(useSimulatorStore.getState().boards.length).toBe(0);

    // 2. Now load an Arduino Uno example
    const uno = findExample('blink-led');
    await loadExample(uno);

    expect(useSimulatorStore.getState().boards.length).toBeGreaterThanOrEqual(1);

    const code = activeSketchContent();
    expect(code, 'editor content after Uno load').toBeDefined();
    expect(code, 'editor must contain the Uno example body').toContain(uno.code.slice(0, 40));
  });

  it('loads Arduino Uno code into the editor after a board-less DIGITAL example', async () => {
    await loadExample(findExample('digital-and-two-switches'));
    expect(useSimulatorStore.getState().boards.length).toBe(0);

    const uno = findExample('blink-led');
    await loadExample(uno);

    const code = activeSketchContent();
    expect(code, 'editor content after Uno load').toBeDefined();
    expect(code, 'editor must contain the Uno example body').toContain(uno.code.slice(0, 40));
  });

  it('switching between two board-less examples does not break a later board load', async () => {
    await loadExample(findExample('an-voltage-divider'));
    await loadExample(findExample('digital-xor-difference'));
    await loadExample(findExample('an-rc-low-pass'));

    const uno = findExample('blink-led');
    await loadExample(uno);

    const code = activeSketchContent();
    expect(code, 'editor content after 3 board-less → Uno load').toBeDefined();
    expect(code, 'editor must contain the Uno example body').toContain(uno.code.slice(0, 40));
  });
});

describe('loadExample — programmable-chip program lives in its own group', () => {
  beforeEach(() => {
    resetStores();
  });

  it('board-less chip example opens the chip program (larson.s) as the active group, editable', async () => {
    await loadExample(findExample('z80-larson-no-board'));

    const ed = useEditorStore.getState();
    expect(useSimulatorStore.getState().boards.length).toBe(0);

    // The chip owns a group-chip-<id> group with its program file.
    const chipGroupId = 'group-chip-z80cpu';
    expect(ed.fileGroups[chipGroupId], 'chip group exists').toBeDefined();
    expect(ed.fileGroups[chipGroupId].map((f) => f.name)).toContain('larson.s');

    // That group is the active one (program shows on the left, editable).
    expect(ed.activeGroupId).toBe(chipGroupId);
    const larson = ed.fileGroups[chipGroupId].find((f) => f.name === 'larson.s');
    expect(larson?.content.length ?? 0, 'larson.s is non-empty').toBeGreaterThan(0);
    expect(activeSketchContent(), 'editor shows the larson.s program').toBe(larson?.content);
  });

  it('board + chip routing keeps the chip program OUT of the board sketch group', async () => {
    // The gallery's chip examples are all board-less now, but the board+chip
    // routing path still applies when a user drops a programmable chip onto a
    // board project — exercise it with an inline synthetic example.
    const boardChip: ExampleProject = {
      id: 'test-board-chip',
      title: 'Board + chip',
      description: '',
      category: 'circuits',
      difficulty: 'beginner',
      boardType: 'arduino-uno',
      code: 'void setup(){}\nvoid loop(){}',
      files: [
        { name: 'sketch.ino', content: 'void setup(){}\nvoid loop(){}' },
        { name: 'prog.s', content: '; chip program' },
      ],
      components: [
        {
          type: 'custom-chip',
          id: 'tchip',
          x: 100,
          y: 100,
          properties: {
            chipName: 'T',
            sourceC: '',
            chipJson: JSON.stringify({ programTargets: ['z80'] }),
            programFile: 'prog.s',
            programTarget: 'z80',
          },
        },
      ],
      wires: [],
    } as unknown as ExampleProject;

    await loadExample(boardChip);

    const ed = useEditorStore.getState();
    const sim = useSimulatorStore.getState();

    // Board group shows only the sketch — prog.s is NOT a sibling tab.
    const board = sim.boards.find((b) => b.id === sim.activeBoardId) ?? sim.boards[0];
    const boardFiles = (ed.fileGroups[board.activeFileGroupId] ?? []).map((f) => f.name);
    expect(boardFiles).toContain('sketch.ino');
    expect(boardFiles, 'prog.s must not pollute the board group').not.toContain('prog.s');

    // The chip program lives in its own group instead.
    const chipGroupId = 'group-chip-tchip';
    expect(ed.fileGroups[chipGroupId]?.map((f) => f.name)).toContain('prog.s');

    // With a board present the board sketch stays the active group.
    expect(ed.activeGroupId).toBe(board.activeFileGroupId);
  });

  it('chip groups from a previous example do not leak into the next', async () => {
    await loadExample(findExample('z80-larson-scanner'));
    expect(useEditorStore.getState().fileGroups['group-chip-z80cpu']).toBeDefined();

    // A plain board example with no custom chip must clear the stale chip group.
    await loadExample(findExample('blink-led'));
    expect(
      useEditorStore.getState().fileGroups['group-chip-z80cpu'],
      'stale chip group swept on next load',
    ).toBeUndefined();
  });
});

describe('isProgrammableChip — detects ROM-loading CPUs by programTargets', () => {
  it('true when chip.json declares programTargets, even with no programFile yet', () => {
    // A chip freshly dropped from the gallery: programFile empty, but its
    // chip.json marks it a CPU. It must still be treated as programmable so a
    // program file gets created for it.
    expect(
      isProgrammableChip({ chipJson: JSON.stringify({ programTargets: ['z80'] }), programFile: '' }),
    ).toBe(true);
  });

  it('true when a programFile is already set', () => {
    expect(isProgrammableChip({ chipJson: '{}', programFile: 'larson.s' })).toBe(true);
  });

  it('false for a behaviour chip (no programTargets, no programFile)', () => {
    expect(
      isProgrammableChip({ chipJson: JSON.stringify({ name: 'Servo driver' }), programFile: '' }),
    ).toBe(false);
    expect(isProgrammableChip({})).toBe(false);
    expect(isProgrammableChip(null)).toBe(false);
  });
});
