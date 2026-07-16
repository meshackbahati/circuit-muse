/**
 * exampleToBuildNetlistInput — single source of truth for converting
 * an `ExampleProject` into the `BuildNetlistInput` the SPICE engine
 * consumes.
 *
 * Used by:
 *   • `loadExample.ts` (production load path)
 *   • smoke tests (`__tests__/examples-*-live.test.ts`)
 *   • any future tool that wants to inspect example netlists
 *     without going through the simulator store
 *
 * If the prefix rules or filtering ever change (e.g. add a new
 * `mfgX-` namespace), update ONLY this file — every consumer picks
 * the new behaviour automatically.
 */
import type { BuildNetlistInput, AnalysisMode } from '../simulation/spice/types';
import { buildInputFromStore } from '../simulation/spice/storeAdapter';
import type { BoardKind } from '../types/board';
import type { ExampleProject } from '../data/examples';

/**
 * Strip the brand prefix from a wokwi-elements / velxio-elements
 * component tag.  Matches the regex used historically inside
 * `loadExample.ts`.
 *
 * Examples:
 *   wokwi-led            → led
 *   wokwi-bjt-2n2222     → bjt-2n2222
 *   velxio-74hc595       → 74hc595
 *   resistor             → resistor (no prefix, untouched)
 */
export function stripBrandPrefix(componentType: string): string {
  return componentType.replace(/^(wokwi|velxio)-/, '');
}

/**
 * Whether a component is a board / MCU (excluded from the SPICE
 * component list — boards are stamped as voltage sources at the pin
 * level, not as full components).
 */
export function isBoardComponentType(componentType: string): boolean {
  const t = componentType.toLowerCase();
  return (
    t.includes('arduino') ||
    t.includes('pico') ||
    t.includes('raspberry') ||
    t.includes('esp32')
  );
}

/**
 * Convert an `ExampleProject` into a `BuildNetlistInput` ready for
 * `NetlistBuilder.buildNetlist`.
 *
 * Delegates to the production `buildInputFromStore` helper so the
 * analysis-picking logic (`.op` vs `.tran` based on signal-generator /
 * MCU-driven reactive networks) is shared with the real load path.
 * That means a smoke test sees the SAME analysis kind a user would
 * trigger by opening the example in the editor.
 *
 * Boards default to empty — for analog-only examples that's fine.
 * Caller can override (e.g. testing a multi-board mixed example).
 */
export function exampleToBuildNetlistInput(
  example: ExampleProject,
  opts: {
    /** Override the analysis-picking result (e.g. force `.op` for a smoke check). */
    analysis?: AnalysisMode;
    /** Inject boards with MCU pin states (otherwise empty — see `pinStates: {}`). */
    boards?: Array<{
      id: string;
      boardKind: BoardKind;
      pinStates: Record<string, never>;
    }>;
  } = {},
): BuildNetlistInput {
  const components = example.components
    .filter((c) => !isBoardComponentType(c.type))
    .map((c) => ({
      id: c.id,
      metadataId: stripBrandPrefix(c.type),
      properties: c.properties ?? {},
    }));

  const wires = example.wires.map((w) => ({
    id: w.id,
    start: { componentId: w.start.componentId, pinName: w.start.pinName },
    end: { componentId: w.end.componentId, pinName: w.end.pinName },
    color: '#666',
    waypoints: [],
  }));

  const input = buildInputFromStore({
    components,
    wires,
    boards: opts.boards ?? [],
  });
  // Caller may override the auto-picked analysis (e.g. force `.op`).
  if (opts.analysis) input.analysis = opts.analysis;
  return input;
}
