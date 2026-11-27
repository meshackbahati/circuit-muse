/**
 * Read the live circuit from the simulator store as a `SchematicInput`.
 * Shared by the schematic view and the KiCad export menu entries.
 */
import { useSimulatorStore } from '../store/useSimulatorStore';
import registry from '../services/ComponentRegistry';
import type { SchematicInput } from './netlist';

type SimState = ReturnType<typeof useSimulatorStore.getState>;

/** metadataId → display name, once the component catalogue has loaded. */
function catalogueNames(): Record<string, string> | undefined {
  if (!registry.isLoaded) return undefined;
  const names: Record<string, string> = {};
  for (const c of registry.getAllComponents()) names[c.id] = c.name;
  return names;
}

export function schematicInputFrom(
  boards: SimState['boards'],
  components: SimState['components'],
  wires: SimState['wires'],
): SchematicInput {
  return {
    boards: boards.map((b) => ({ id: b.id, boardKind: b.boardKind, name: b.name, x: b.x, y: b.y })),
    components: components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      properties: c.properties,
      x: c.x,
      y: c.y,
    })),
    wires: wires.map((w) => ({
      id: w.id,
      start: { componentId: w.start.componentId, pinName: w.start.pinName },
      end: { componentId: w.end.componentId, pinName: w.end.pinName },
    })),
    componentNames: catalogueNames(),
  };
}

export function schematicInputFromStore(): SchematicInput {
  const s = useSimulatorStore.getState();
  return schematicInputFrom(s.boards, s.components, s.wires);
}

/**
 * A string that changes only when something the schematic depends on
 * changes (not on serial output, LED state, wire colours, ...).
 */
export function schematicSignature(
  boards: SimState['boards'],
  components: SimState['components'],
  wires: SimState['wires'],
): string {
  const parts: string[] = [];
  for (const b of boards) parts.push(`B${b.id}|${b.boardKind}|${b.name ?? ''}`);
  for (const c of components) {
    const p = c.properties ?? {};
    parts.push(
      `C${c.id}|${c.metadataId}|${String(p.value ?? '')}|${String(p.resistance ?? '')}|${String(p.color ?? '')}|${String(p.label ?? '')}|${String(p.total ?? '')}`,
    );
  }
  for (const w of wires) parts.push(`W${w.start.componentId}:${w.start.pinName}>${w.end.componentId}:${w.end.pinName}`);
  return parts.join('\n');
}
