// @vitest-environment jsdom
/**
 * Smoke test for the single-board Raspberry Pi 3/4/5 examples: each must
 * load into the stores with the right board kind, the expected components,
 * and a non-empty Python script in the board's VFS (script.py).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useVfsStore } from '../store/useVfsStore';
import { useElectricalStore } from '../store/useElectricalStore';
import { loadExample } from '../utils/loadExample';
import { exampleProjects } from '../data/examples';

function resetStores() {
  const sim = useSimulatorStore.getState();
  for (const id of sim.boards.map((b) => b.id)) sim.removeBoard(id);
  useElectricalStore.getState().setPaused(false);
}

const CASES: { id: string; kind: string; minComponents: number }[] = [
  { id: 'pi3-blink-led',         kind: 'raspberry-pi-3', minComponents: 1 },
  { id: 'pi3-running-lights',    kind: 'raspberry-pi-3', minComponents: 5 },
  { id: 'pi4-button-led',        kind: 'raspberry-pi-4', minComponents: 2 },
  { id: 'pi4-rgb-color-cycle',   kind: 'raspberry-pi-4', minComponents: 1 },
  { id: 'pi5-pir-motion-alarm',  kind: 'raspberry-pi-5', minComponents: 2 },
  { id: 'pi5-traffic-light',     kind: 'raspberry-pi-5', minComponents: 3 },
];

describe('Raspberry Pi 3/4/5 single-board examples', () => {
  beforeEach(() => {
    resetStores();
  });

  for (const c of CASES) {
    it(`loads ${c.id} (single ${c.kind}, gpiozero script, components wired)`, async () => {
      const example = exampleProjects.find((e) => e.id === c.id);
      expect(example, `example ${c.id} exists`).toBeDefined();

      await loadExample(example!);

      const sim = useSimulatorStore.getState();
      // Exactly one board, of the expected Pi kind.
      expect(sim.boards).toHaveLength(1);
      expect(sim.boards[0].boardKind).toBe(c.kind);

      // Components placed.
      expect(sim.components.length).toBeGreaterThanOrEqual(c.minComponents);

      // Every wire endpoint references either the board or a placed component.
      const ids = new Set<string>([sim.boards[0].id, ...sim.components.map((comp) => comp.id)]);
      for (const w of sim.wires) {
        expect(ids.has(w.start.componentId)).toBe(true);
        expect(ids.has(w.end.componentId)).toBe(true);
      }

      // The Python script landed in the board's VFS (script.py, non-empty).
      const tree = useVfsStore.getState().getTree(sim.boards[0].id);
      const scriptNode = Object.values(tree).find(
        (n) => n.type === 'file' && n.name === 'script.py',
      );
      expect(scriptNode, 'script.py present in VFS').toBeTruthy();
      expect(scriptNode!.content ?? '').toContain('gpiozero');
    });
  }
});
