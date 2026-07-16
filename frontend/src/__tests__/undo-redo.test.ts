/**
 * Unit tests for the undo/redo history slice in useSimulatorStore.
 *
 * The store is a singleton, so each test resets it to a known baseline
 * via the existing `setComponents([])` / `setWires([])` mutators (which
 * also clear history — see beforeEach).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { Wire } from '../types/wire';

// Stub out anything that touches a custom-element or a real simulator —
// these tests only exercise the store's data layer.
vi.mock('../utils/pinPositionCalculator', () => ({
  // updateWirePositions calls this; returning null = "fall back to raw x/y".
  calculatePinPosition: () => null,
}));

const led = (id: string, x = 0, y = 0) => ({
  id,
  metadataId: 'led',
  x,
  y,
  properties: { color: 'red' },
});

const wire = (id: string, fromId: string, toId: string): Wire => ({
  id,
  start: { componentId: fromId, pinName: 'A', x: 0, y: 0 },
  end: { componentId: toId, pinName: 'C', x: 0, y: 0 },
  waypoints: [],
  color: '#22c55e',
});

beforeEach(() => {
  // Wipe the canvas + history before every test.
  const s = useSimulatorStore.getState();
  s.setComponents([]);
  s.setWires([]);
});

describe('history primitives', () => {
  it('starts empty', () => {
    const s = useSimulatorStore.getState();
    expect(s.history).toEqual([]);
    expect(s.historyIndex).toBe(-1);
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('caps at HISTORY_MAX (50)', () => {
    const s = useSimulatorStore.getState();
    for (let i = 0; i < 60; i++) {
      s.recordAddComponent(led(`led-${i}`));
    }
    const after = useSimulatorStore.getState();
    expect(after.history.length).toBe(50);
    expect(after.historyIndex).toBe(49);
    // The 10 oldest commands were dropped — undoing 50 times should NOT
    // restore the canvas to fully empty.
    for (let i = 0; i < 50; i++) after.undo();
    const afterUndo = useSimulatorStore.getState();
    // The first 10 leds were never undoable — they stay on the canvas.
    expect(afterUndo.components.length).toBe(10);
  });

  it('truncates the redo branch when a new command pushes mid-history', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('a'));
    s.recordAddComponent(led('b'));
    s.recordAddComponent(led('c'));
    s.undo(); // c removed, history still has 3 entries, index=1
    s.undo(); // b removed, index=0
    expect(useSimulatorStore.getState().historyIndex).toBe(0);
    expect(useSimulatorStore.getState().history.length).toBe(3);
    s.recordAddComponent(led('d')); // truncates b/c, pushes d
    const after = useSimulatorStore.getState();
    expect(after.history.length).toBe(2); // a + d
    expect(after.historyIndex).toBe(1);
    expect(after.components.map((c) => c.id).sort()).toEqual(['a', 'd']);
  });
});

describe('recordAddComponent', () => {
  it('adds the component and pushes a command', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('x'));
    expect(useSimulatorStore.getState().components).toHaveLength(1);
    expect(useSimulatorStore.getState().history).toHaveLength(1);
    expect(useSimulatorStore.getState().canUndo()).toBe(true);
  });

  it('undo removes it; redo restores it', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('x'));
    s.undo();
    expect(useSimulatorStore.getState().components).toHaveLength(0);
    expect(useSimulatorStore.getState().canUndo()).toBe(false);
    expect(useSimulatorStore.getState().canRedo()).toBe(true);
    s.redo();
    expect(useSimulatorStore.getState().components).toHaveLength(1);
  });
});

describe('recordRemoveComponent (cascade)', () => {
  it('undo restores BOTH the component and its connected wires', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('a'));
    s.addComponent(led('b'));
    s.addWire(wire('w1', 'a', 'b'));
    s.addWire(wire('w2', 'a', 'b'));
    // Remove 'a' — cascade should kill both wires.
    s.recordRemoveComponent('a');
    expect(useSimulatorStore.getState().components.map((c) => c.id)).toEqual(['b']);
    expect(useSimulatorStore.getState().wires).toEqual([]);
    s.undo();
    const after = useSimulatorStore.getState();
    expect(after.components.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(after.wires.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });

  it('no-ops cleanly on a missing id', () => {
    const s = useSimulatorStore.getState();
    s.recordRemoveComponent('does-not-exist');
    expect(useSimulatorStore.getState().history).toHaveLength(0);
  });
});

describe('recordMove', () => {
  it('captures from/to, undo restores from, redo restores to', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('m', 100, 100));
    // Simulate a drag — UI mutated to (200,200) directly via raw mutator.
    s.updateComponent('m', { x: 200, y: 200 });
    // Drag-end records the diff.
    s.recordMove('m', { x: 100, y: 100 }, { x: 200, y: 200 });
    expect(useSimulatorStore.getState().components[0]).toMatchObject({ x: 200, y: 200 });
    s.undo();
    expect(useSimulatorStore.getState().components[0]).toMatchObject({ x: 100, y: 100 });
    s.redo();
    expect(useSimulatorStore.getState().components[0]).toMatchObject({ x: 200, y: 200 });
  });
});

describe('recordRotate', () => {
  it('flips rotation property both directions', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('r'));
    s.recordRotate('r', 0, 90);
    s.updateComponent('r', { properties: { color: 'red', rotation: 90 } });
    s.undo();
    expect(useSimulatorStore.getState().components[0].properties.rotation).toBe(0);
    s.redo();
    expect(useSimulatorStore.getState().components[0].properties.rotation).toBe(90);
  });
});

describe('recordSetProperty', () => {
  it('undo/redo flips a property value', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('p'));
    s.updateComponent('p', { properties: { color: 'green' } });
    s.recordSetProperty('p', 'color', 'red', 'green');
    s.undo();
    expect(useSimulatorStore.getState().components[0].properties.color).toBe('red');
    s.redo();
    expect(useSimulatorStore.getState().components[0].properties.color).toBe('green');
  });
});

describe('recordAddWire / recordRemoveWire', () => {
  it('add: undo removes, redo restores', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('a'));
    s.addComponent(led('b'));
    s.recordAddWire(wire('w', 'a', 'b'));
    expect(useSimulatorStore.getState().wires).toHaveLength(1);
    s.undo();
    expect(useSimulatorStore.getState().wires).toHaveLength(0);
    s.redo();
    expect(useSimulatorStore.getState().wires).toHaveLength(1);
  });

  it('remove: undo brings back the wire intact', () => {
    const s = useSimulatorStore.getState();
    s.addComponent(led('a'));
    s.addComponent(led('b'));
    const w = wire('w', 'a', 'b');
    s.addWire(w);
    s.recordRemoveWire('w');
    expect(useSimulatorStore.getState().wires).toHaveLength(0);
    s.undo();
    expect(useSimulatorStore.getState().wires[0]).toEqual(w);
  });
});

describe('bulk setters clear history', () => {
  it('setComponents wipes the stack', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('x'));
    s.recordAddComponent(led('y'));
    expect(useSimulatorStore.getState().history).toHaveLength(2);
    s.setComponents([]);
    expect(useSimulatorStore.getState().history).toHaveLength(0);
    expect(useSimulatorStore.getState().historyIndex).toBe(-1);
  });

  it('setWires wipes the stack', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('x'));
    s.setWires([]);
    expect(useSimulatorStore.getState().history).toHaveLength(0);
  });
});

describe('clearHistory', () => {
  it('resets index and entries without touching components/wires', () => {
    const s = useSimulatorStore.getState();
    s.recordAddComponent(led('keep'));
    s.clearHistory();
    const after = useSimulatorStore.getState();
    expect(after.components).toHaveLength(1); // component still there
    expect(after.history).toHaveLength(0);
    expect(after.canUndo()).toBe(false);
  });
});
