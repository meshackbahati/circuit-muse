import type { ToolCall } from './types';
import { auditWiring, boardPinExists, type WiringAuditResult } from './wiringAudit';

type MutableState = any;

/** Refs created by `build_circuit`, so a later wire_components call can use
 *  the same short names instead of asking the model to copy generated ids. */
let lastBuildRefs = new Map<string, string>();

function tail(text: string | undefined, max = 4000): string {
  if (!text) return '';
  return text.length > max ? text.slice(-max) : text;
}

function abortResult(): string {
  return JSON.stringify({ success: false, aborted: true, error: 'Stopped by user' });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Let a tool return as soon as Stop is pressed even when the underlying
 *  compile or install call does not accept an AbortSignal. The call keeps
 *  running in the background, but its result is ignored. */
async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function currentAudit(sim: MutableState): WiringAuditResult {
  return auditWiring({
    boards: sim.boards.map((b: MutableState) => ({
      id: b.id,
      boardKind: b.boardKind,
      name: b.name,
    })),
    components: sim.components.map((c: MutableState) => ({
      id: c.id,
      metadataId: c.metadataId,
      properties: c.properties ?? c.attrs ?? {},
    })),
    wires: sim.wires,
  });
}

function wiringBlocked(audit: WiringAuditResult): string {
  return JSON.stringify({
    success: false,
    blocked_by: 'wiring',
    error: `Compile refused: the canvas is not fully wired. ${audit.blocking_issues
      .map((issue) => issue.reason)
      .join(' ')}`,
    wiring: audit,
    next_actions: audit.next_actions,
  });
}

function boardOutput(sim: MutableState, boardId?: string): {
  serial_output: string;
  serial_length: number;
  running: boolean;
  crash_board_id: string | null;
} {
  const board = boardId
    ? sim.boards.find((b: MutableState) => b.id === boardId)
    : sim.boards.find((b: MutableState) => b.id === sim.activeBoardId) ?? sim.boards[0];
  const text = board?.serialOutput ?? sim.serialOutput ?? '';
  return {
    serial_output: tail(text, 6000),
    serial_length: text.length,
    running: Boolean(board?.running),
    crash_board_id: sim.esp32CrashBoardId ?? null,
  };
}

/** Wait for serial output to grow, or for the observation window to expire.
 *  A run followed immediately by get_simulation_output used to read an empty
 *  buffer because the sketch had not reached Serial.begin yet. */
async function observeBoard(
  sim: MutableState,
  boardId: string | undefined,
  waitMs: number,
  signal?: AbortSignal,
): Promise<{ serial_output: string; serial_length: number; running: boolean; crash_board_id: string | null; waited_ms: number }> {
  const start = Date.now();
  const initial = boardOutput(sim, boardId).serial_length;
  const budget = Math.max(0, Math.min(waitMs, 10_000));
  if (budget > 0) {
    try {
      while (Date.now() - start < budget) {
        const state = useSimulatorStoreSnapshot();
        const current = boardOutput(state, boardId);
        if (current.serial_length > initial && /[\r\n]/.test(current.serial_output)) break;
        await sleep(Math.min(120, Math.max(20, budget - (Date.now() - start))), signal);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  const state = useSimulatorStoreSnapshot();
  return { ...boardOutput(state, boardId), waited_ms: Date.now() - start };
}

/** The store module is imported dynamically to avoid a cycle at module load;
 *  after the first tool call it is cached, so this accessor is cheap. */
let simulatorStoreRef: MutableState | null = null;
function useSimulatorStoreSnapshot(): MutableState {
  if (!simulatorStoreRef) {
    throw new Error('Simulator store is not ready');
  }
  return simulatorStoreRef.getState();
}

function resolvePartId(part: string, known: Set<string>): string | null {
  if (known.has(part)) return part;
  const mapped = lastBuildRefs.get(part);
  if (mapped && known.has(mapped)) return mapped;
  return null;
}

function componentPinNames(componentId: string): string[] | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(componentId) as
    | { pinInfo?: Array<{ name?: string }> }
    | null;
  const info = element?.pinInfo;
  if (!Array.isArray(info)) return null;
  const names = info.map((pin) => String(pin?.name ?? '').trim()).filter(Boolean);
  return names.length > 0 ? names : null;
}

function resolveBoard(sim: MutableState, requested?: string): MutableState | null {
  if (requested) return sim.boards.find((b: MutableState) => b.id === requested) ?? null;
  const active = sim.boards.find((b: MutableState) => b.id === sim.activeBoardId);
  return active ?? sim.boards[0] ?? null;
}

function isEsp32Kind(kind: string): boolean {
  return kind.includes('esp32');
}

type ComponentMeta = {
  id: string;
  name: string;
  tagName: string;
  category: string;
  pinCount?: number;
  tags?: string[];
};

async function loadComponentMetadata(): Promise<ComponentMeta[]> {
  const module = await import('../../public/components-metadata.json');
  return (module.default as any).components ?? [];
}

// Tool names are aliases; the canvas needs the real metadata id.
function resolveComponentType(requested: string, metadata: ComponentMeta[]): ComponentMeta | null {
  const base = requested.trim().replace(/^wokwi-/, '').replace(/^circuit-muse-/, '');
  if (!base) return null;
  const exact = metadata.find(m =>
    m.id === requested || m.tagName === requested || m.id === base || m.tagName === base,
  );
  if (exact) return exact;
  return metadata.find(m =>
    m.id.includes(base) || m.name.toLowerCase().includes(base.toLowerCase()),
  ) ?? null;
}

const COMPONENT_HINTS: Array<{ hint: string; pins: string[]; defaultAttrs?: Record<string, unknown> }> = [
  { hint: 'wokwi-led', pins: ['A', 'C'], defaultAttrs: { color: 'red' } },
  { hint: 'wokwi-resistor', pins: ['1', '2'], defaultAttrs: { value: '220' } },
  { hint: 'inductor', pins: ['1', '2'], defaultAttrs: { value: '10m' } },
  { hint: 'wokwi-pushbutton', pins: ['1.l', '2.l', '1.r', '2.r'] },
  { hint: 'wokwi-buzzer', pins: ['1', '2'] },
  { hint: 'wokwi-servo', pins: ['GND', 'V+', 'PWM'] },
  { hint: 'wokwi-potentiometer', pins: ['GND', 'SIG', 'VCC'] },
  { hint: 'wokwi-slide-switch', pins: ['1', '2', '3'] },
  { hint: 'dht22', pins: ['VCC', 'SDA', 'NC', 'GND'] },
  { hint: 'hc-sr04', pins: ['VCC', 'TRIG', 'ECHO', 'GND'] },
  { hint: 'mpu6050', pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'] },
  { hint: 'bmp280', pins: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'] },
  { hint: 'ssd1306', pins: ['GND', 'VCC', 'SCL', 'SDA'] },
  { hint: 'wokwi-lcd1602', pins: ['GND', 'VCC', 'SDA', 'SCL'] },
  { hint: 'wokwi-neopixel', pins: ['VDD', 'DIN', 'GND', 'DOUT'] },
  { hint: 'wokwi-7segment', pins: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP', 'COM'] },
  { hint: 'wokwi-membrane-keypad', pins: ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'] },
  { hint: 'wokwi-relay-module', pins: ['VCC', 'GND', 'IN', 'NO', 'COM', 'NC'] },
];

function filesForBoard(editor: MutableState, board: MutableState | null): Array<{ name: string; content: string }> {
  const group = board?.activeFileGroupId ? editor.fileGroups?.[board.activeFileGroupId] : null;
  const source = group && group.length > 0 ? group : editor.files;
  return (source ?? []).map((f: MutableState) => ({ name: f.name, content: f.content }));
}

export async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(argsStr);
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments' });
  }

  if (signal?.aborted) return abortResult();

  const { useSimulatorStore } = await import('../store/useSimulatorStore');
  const { useCompileLogsStore } = await import('../store/useCompileLogsStore');
  const { useEditorStore } = await import('../store/useEditorStore');
  simulatorStoreRef = useSimulatorStore;

  if (signal?.aborted) return abortResult();

  switch (name) {
    case 'add_board': {
      const sim = useSimulatorStore.getState();
      const id = sim.addBoard(args.board_kind, args.x ?? 400, args.y ?? 300);
      return JSON.stringify({ success: true, board_id: id, board_kind: args.board_kind });
    }
    case 'remove_board': {
      const sim = useSimulatorStore.getState();
      sim.removeBoard(args.board_id);
      return JSON.stringify({ success: true });
    }
    case 'add_component': {
      const metadata = await loadComponentMetadata();
      const requested = String(args.type ?? '');
      const resolved = resolveComponentType(requested, metadata);
      if (!resolved) {
        const base = requested.replace(/^wokwi-/, '').toLowerCase();
        const suggestions = metadata
          .filter(m => m.id.includes(base) || m.name.toLowerCase().includes(base))
          .slice(0, 10)
          .map(m => m.id);
        return JSON.stringify({ error: `Unknown component type: ${requested}`, suggestions });
      }
      const sim = useSimulatorStore.getState();
      const component = {
        id: `comp-${Date.now()}`,
        metadataId: resolved.id,
        left: args.x ?? 200,
        top: args.y ?? 200,
        rotate: args.rotation ?? 0,
        attrs: args.attrs ?? {},
        x: args.x ?? 200,
        y: args.y ?? 200,
        properties: args.attrs ?? {},
      } as any;
      sim.recordAddComponent(component);
      return JSON.stringify({ success: true, component_id: component.id, type: resolved.id });
    }
    case 'build_circuit': {
      const metadata = await loadComponentMetadata();
      const rawComponents = Array.isArray(args.components) ? args.components : [];
      const rawWires = Array.isArray(args.wires) ? args.wires : [];
      if (rawComponents.length === 0) {
        return JSON.stringify({ error: 'build_circuit needs at least one component. Use add_board for boards.' });
      }

      const sim = useSimulatorStore.getState();
      const known = new Set<string>([
        ...sim.boards.map((b: MutableState) => b.id),
        ...sim.components.map((c: MutableState) => c.id),
      ]);
      const refs = new Set<string>();
      const prepared: Array<{ ref: string; resolved: ComponentMeta; raw: MutableState }> = [];

      for (const raw of rawComponents) {
        const ref = String(raw?.ref ?? '').trim();
        if (!ref) return JSON.stringify({ error: 'Every component in build_circuit needs a ref such as "led1".' });
        if (refs.has(ref) || known.has(ref)) {
          return JSON.stringify({ error: `Duplicate component ref ${ref}. Use a unique ref for each part.` });
        }
        refs.add(ref);
        const requested = String(raw?.type ?? '');
        const resolved = resolveComponentType(requested, metadata);
        if (!resolved) {
          return JSON.stringify({
            error: `Unknown component type: ${requested}`,
            suggestions: metadata
              .filter((m) => m.id.includes(requested.replace(/^wokwi-/, '').toLowerCase()))
              .slice(0, 10)
              .map((m) => m.id),
          });
        }
        prepared.push({ ref, resolved, raw });
      }

      const boardById = new Map<string, MutableState>(sim.boards.map((b: MutableState) => [b.id, b]));
      for (const wire of rawWires) {
        const from = String(wire?.from ?? wire?.from_part ?? '');
        const to = String(wire?.to ?? wire?.to_part ?? '');
        const fromPin = String(wire?.from_pin ?? '');
        const toPin = String(wire?.to_pin ?? '');
        if (!from || !to || !fromPin || !toPin) {
          return JSON.stringify({ error: 'Every wire needs from, from_pin, to and to_pin.' });
        }
        for (const part of [from, to]) {
          if (refs.has(part) || known.has(part)) continue;
          return JSON.stringify({ error: `Wire endpoint ${part} is neither a ref in this build nor a part already on the canvas.` });
        }
        const fromBoard = boardById.get(from);
        if (fromBoard && !boardPinExists(fromBoard.boardKind, fromPin)) {
          return JSON.stringify({ error: `Board pin ${fromPin} does not exist on ${fromBoard.boardKind}.` });
        }
        const toBoard = boardById.get(to);
        if (toBoard && !boardPinExists(toBoard.boardKind, toPin)) {
          return JSON.stringify({ error: `Board pin ${toPin} does not exist on ${toBoard.boardKind}.` });
        }
      }

      const stamp = Date.now();
      const created: Array<{ ref: string; component_id: string; type: string }> = [];
      const refMap = new Map<string, string>();
      for (let index = 0; index < prepared.length; index++) {
        const { ref, resolved, raw } = prepared[index];
        const id = `comp-${stamp}-${index}`;
        const component = {
          id,
          metadataId: resolved.id,
          left: raw.x ?? 200,
          top: raw.y ?? 200,
          rotate: raw.rotation ?? 0,
          attrs: raw.attrs ?? {},
          x: raw.x ?? 200,
          y: raw.y ?? 200,
          properties: raw.attrs ?? {},
        } as MutableState;
        useSimulatorStore.getState().recordAddComponent(component);
        refMap.set(ref, id);
        created.push({ ref, component_id: id, type: resolved.id });
      }
      lastBuildRefs = refMap;

      const addedWires: Array<Record<string, unknown>> = [];
      for (let index = 0; index < rawWires.length; index++) {
        const raw = rawWires[index];
        const from = refMap.get(String(raw.from ?? raw.from_part)) ?? String(raw.from ?? raw.from_part);
        const to = refMap.get(String(raw.to ?? raw.to_part)) ?? String(raw.to ?? raw.to_part);
        const waypoints = Array.isArray(raw.waypoints)
          ? raw.waypoints
              .filter((point: unknown): point is { x: number; y: number } => {
                if (!point || typeof point !== 'object') return false;
                const value = point as { x?: unknown; y?: unknown };
                return typeof value.x === 'number' && typeof value.y === 'number';
              })
              .map((point: { x: number; y: number }) => ({ x: point.x, y: point.y }))
          : [];
        const wire = {
          id: `wire-${stamp}-${index}`,
          start: { componentId: from, pinName: String(raw.from_pin) },
          end: { componentId: to, pinName: String(raw.to_pin) },
          color: raw.color ?? 'green',
          waypoints,
        } as MutableState;
        useSimulatorStore.getState().recordAddWire(wire);
        addedWires.push({
          wire_id: wire.id,
          from_part: from,
          from_pin: wire.start.pinName,
          to_part: to,
          to_pin: wire.end.pinName,
        });
      }

      const audit = currentAudit(useSimulatorStore.getState());
      return JSON.stringify({
        success: true,
        components: created,
        wires: addedWires,
        wiring: audit,
        next_actions: audit.next_actions,
      });
    }
    case 'remove_component': {
      const sim = useSimulatorStore.getState();
      if (!sim.components.some((c: MutableState) => c.id === args.component_id)) {
        // Removal is idempotent: a retry after a stale id must not trap the
        // agent in a loop when the part is already gone.
        return JSON.stringify({ success: true, component_id: args.component_id, already_removed: true });
      }
      sim.recordRemoveComponent(args.component_id);
      return JSON.stringify({ success: true, component_id: args.component_id });
    }
    case 'set_component_property': {
      const sim = useSimulatorStore.getState();
      const component = sim.components.find((c: MutableState) => c.id === args.component_id);
      if (!component) return JSON.stringify({ error: `Component not found: ${args.component_id}` });
      if (typeof args.name !== 'string' || args.name.length === 0) {
        return JSON.stringify({ error: 'A property name is required' });
      }
      const previous = component.properties?.[args.name];
      sim.recordSetProperty(component.id, args.name, previous, args.value);
      return JSON.stringify({ success: true, component_id: component.id, name: args.name, value: args.value });
    }
    case 'wire_components': {
      const sim = useSimulatorStore.getState();
      const parts = [args.from_part, args.from_pin, args.to_part, args.to_pin];
      if (parts.some(p => typeof p !== 'string' || p.trim().length === 0)) {
        return JSON.stringify({ error: 'from_part, from_pin, to_part and to_pin are all required strings' });
      }
      const known = new Set<string>([
        ...sim.boards.map((b: MutableState) => b.id),
        ...sim.components.map((c: MutableState) => c.id),
      ]);
      const fromId = resolvePartId(String(args.from_part), known);
      const toId = resolvePartId(String(args.to_part), known);
      if (!fromId) return JSON.stringify({ error: `Part not found on canvas: ${args.from_part}` });
      if (!toId) return JSON.stringify({ error: `Part not found on canvas: ${args.to_part}` });

      const fromBoard = sim.boards.find((b: MutableState) => b.id === fromId);
      if (fromBoard && !boardPinExists(fromBoard.boardKind, String(args.from_pin))) {
        return JSON.stringify({
          error: `Board pin ${args.from_pin} does not exist on ${fromBoard.boardKind}. Use get_pin_names to read the exact pin names.`,
        });
      }
      const toBoard = sim.boards.find((b: MutableState) => b.id === toId);
      if (toBoard && !boardPinExists(toBoard.boardKind, String(args.to_pin))) {
        return JSON.stringify({
          error: `Board pin ${args.to_pin} does not exist on ${toBoard.boardKind}. Use get_pin_names to read the exact pin names.`,
        });
      }
      const fromPins = componentPinNames(fromId);
      if (fromPins && !fromPins.includes(String(args.from_pin))) {
        return JSON.stringify({
          error: `Pin ${args.from_pin} does not exist on ${fromId}. Valid pins: ${fromPins.join(', ')}.`,
        });
      }
      const toPins = componentPinNames(toId);
      if (toPins && !toPins.includes(String(args.to_pin))) {
        return JSON.stringify({
          error: `Pin ${args.to_pin} does not exist on ${toId}. Valid pins: ${toPins.join(', ')}.`,
        });
      }
      const duplicate = sim.wires.find(
        (w: MutableState) =>
          (w.start.componentId === fromId &&
            w.start.pinName === args.from_pin &&
            w.end.componentId === toId &&
            w.end.pinName === args.to_pin) ||
          (w.start.componentId === toId &&
            w.start.pinName === args.to_pin &&
            w.end.componentId === fromId &&
            w.end.pinName === args.from_pin),
      );
      if (duplicate) {
        return JSON.stringify({ success: true, wire_id: duplicate.id, duplicate: true });
      }

      const waypoints = Array.isArray(args.waypoints)
        ? args.waypoints
            .filter((p: unknown): p is { x: number; y: number } => {
              if (!p || typeof p !== 'object') return false;
              const point = p as { x?: unknown; y?: unknown };
              return typeof point.x === 'number' && typeof point.y === 'number';
            })
            .map((p) => ({ x: p.x, y: p.y }))
        : [];
      const wire = {
        id: `wire-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        start: { componentId: fromId, pinName: String(args.from_pin) },
        end: { componentId: toId, pinName: String(args.to_pin) },
        color: args.color ?? 'green',
        waypoints,
      } as any;
      sim.recordAddWire(wire);
      const audit = currentAudit(useSimulatorStore.getState());
      return JSON.stringify({
        success: true,
        wire_id: wire.id,
        wiring_complete: audit.complete,
        next_actions: audit.next_actions,
      });
    }
    case 'remove_wire': {
      const sim = useSimulatorStore.getState();
      if (!sim.wires.some((w: MutableState) => w.id === args.wire_id)) {
        // Idempotent for the same reason as remove_component: a stale id from
        // an earlier turn must not stall the repair loop.
        return JSON.stringify({ success: true, wire_id: args.wire_id, already_removed: true });
      }
      sim.recordRemoveWire(args.wire_id);
      return JSON.stringify({ success: true, wire_id: args.wire_id });
    }
    case 'get_pin_names': {
      let pins: Array<{ name: string; signals: string[] }> = [];
      if (typeof document !== 'undefined') {
        const element = document.getElementById(args.part_id) as MutableState | null;
        if (element?.pinInfo) {
          pins = Array.from(element.pinInfo as Array<MutableState>).map((p) => ({
            name: p.name,
            signals: p.signals ?? [],
          }));
        }
      }
      if (pins.length === 0) {
        return JSON.stringify({
          error: `No pins found for ${args.part_id}. Use get_circuit_state to list canvas part ids, then wire by those ids.`,
        });
      }
      return JSON.stringify({ part_id: args.part_id, pins });
    }
    case 'check_wiring': {
      const audit = currentAudit(useSimulatorStore.getState());
      const includeWires = args.include_wires !== false;
      return JSON.stringify({
        complete: audit.complete,
        wire_count: audit.wire_count,
        blocking_issues: audit.blocking_issues,
        warnings: audit.warnings,
        unconnected_components: audit.unconnected_components,
        incomplete_components: audit.incomplete_components,
        orphan_wires: audit.orphan_wires,
        boards_without_ground: audit.boards_without_ground,
        next_actions: audit.next_actions,
        ...(includeWires ? { wires: audit.wires } : {}),
      });
    }
    case 'compile_code': {
      const { compileCode } = await import('../services/compilation');
      const { BOARD_KIND_FQBN } = await import('../types/board');
      const { parseCompileResult } = await import('../utils/compilationLogger');

      const sim = useSimulatorStore.getState();
      const audit = currentAudit(sim);
      if (!audit.complete) return wiringBlocked(audit);

      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      const fqbn = (BOARD_KIND_FQBN as Record<string, string | null>)[board.boardKind];
      if (!fqbn) return JSON.stringify({ error: `No compiler target for board kind ${board.boardKind}` });

      const editor = useEditorStore.getState();
      const files = filesForBoard(editor, board);
      if (files.length === 0) return JSON.stringify({ error: 'No source files to compile' });

      // Show the console so the build is visible.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('circuit-muse-open-console'));
      }

      let result: MutableState;
      try {
        result = await raceAbort(compileCode(files, fqbn, null), signal);
      } catch (error) {
        if (signal?.aborted) return abortResult();
        return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
      throwIfAborted(signal);

      useCompileLogsStore.getState().appendLogs(parseCompileResult(result, board.name || board.boardKind, {
        id: board.id,
        label: board.name || board.boardKind,
        kind: 'board',
      }));

      if (!result.success) {
        sim.updateBoard(board.id, { compiledProgram: null });
        const diagnostics = [result.error, result.stderr, tail(result.stdout)]
          .filter(Boolean)
          .join('\n');
        return JSON.stringify({
          success: false,
          board_id: board.id,
          error: tail(diagnostics, 6000) || 'Compilation failed',
        });
      }

      const program = result.hex_content ?? result.binary_content ?? null;
      if (!program) {
        sim.updateBoard(board.id, { compiledProgram: null });
        return JSON.stringify({ success: false, board_id: board.id, error: 'Compiler produced no program image' });
      }
      sim.compileBoardProgram(board.id, program);

      let run: MutableState = null;
      if (args.run_after === true) {
        useSimulatorStore.getState().startBoard(board.id);
        const observed = await observeBoard(
          useSimulatorStore.getState(),
          board.id,
          Number(args.observe_ms ?? 1500),
          signal,
        );
        run = observed;
      }

      return JSON.stringify({
        success: true,
        board_id: board.id,
        board_kind: board.boardKind,
        message: 'Compilation successful; firmware loaded into the board',
        wiring_complete: audit.complete,
        stdout_tail: tail(result.stdout, 2000),
        ...(run ? { run } : {}),
      });
    }
    case 'compile_all_code': {
      const sim = useSimulatorStore.getState();
      const audit = currentAudit(sim);
      if (!audit.complete) return wiringBlocked(audit);

      const results: Array<Record<string, unknown>> = [];
      for (const board of sim.boards) {
        throwIfAborted(signal);
        const raw = await executeToolCall(
          {
            id: `compile-${board.id}`,
            type: 'function',
            function: { name: 'compile_code', arguments: JSON.stringify({ board_id: board.id, run_after: false }) },
          },
          signal,
        );
        if (signal?.aborted) return abortResult();
        results.push({ board_id: board.id, ...JSON.parse(raw) });
      }

      let runs: MutableState[] = [];
      if (args.run_after === true) {
        const refreshed = useSimulatorStore.getState();
        for (const board of refreshed.boards) {
          if (!board.compiledProgram) continue;
          refreshed.startBoard(board.id);
        }
        for (const board of useSimulatorStore.getState().boards) {
          if (!board.compiledProgram) continue;
          runs.push({
            board_id: board.id,
            ...(await observeBoard(
              useSimulatorStore.getState(),
              board.id,
              Number(args.observe_ms ?? 1200),
              signal,
            )),
          });
        }
      }

      return JSON.stringify({
        success: results.every(r => r.success === true),
        wiring_complete: audit.complete,
        boards: results,
        ...(runs.length > 0 ? { runs } : {}),
      });
    }
    case 'run_simulation': {
      const sim = useSimulatorStore.getState();
      const audit = currentAudit(sim);
      if (!audit.complete) return wiringBlocked(audit);

      const runAll = args.run_all === true;
      const board = resolveBoard(sim, args.board_id);
      if (!runAll && !board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      if (!runAll && !board.compiledProgram) {
        return JSON.stringify({
          error: `Board ${board.id} has no compiled firmware. Call compile_code before run_simulation.`,
        });
      }

      const started: string[] = [];
      if (runAll) {
        for (const candidate of sim.boards) {
          if (!candidate.compiledProgram) continue;
          useSimulatorStore.getState().startBoard(candidate.id);
          started.push(candidate.id);
        }
      } else if (args.board_id) {
        sim.startBoard(board.id);
        started.push(board.id);
      } else {
        sim.startSimulation();
        started.push(board.id);
      }

      const observeMs = Number(args.observe_ms ?? 1500);
      const runs = [];
      for (const boardId of started) {
        runs.push({
          board_id: boardId,
          ...(await observeBoard(useSimulatorStore.getState(), boardId, observeMs, signal)),
        });
      }
      const first = runs[0];
      return JSON.stringify({
        success: true,
        board_id: runAll ? null : board.id,
        run_all: runAll,
        started,
        running: first?.running ?? false,
        serial_output: first?.serial_output ?? '',
        serial_length: first?.serial_length ?? 0,
        crash_board_id: first?.crash_board_id ?? null,
        runs,
        message: first?.serial_output
          ? 'Simulation running; serial output captured'
          : 'Simulation started; no serial output yet',
      });
    }
    case 'stop_simulation': {
      const sim = useSimulatorStore.getState();
      const stopped: string[] = [];
      if (args.board_id) {
        const board = resolveBoard(sim, args.board_id);
        if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id}` });
        sim.stopBoard(board.id);
        stopped.push(board.id);
      } else {
        for (const board of sim.boards) {
          sim.stopBoard(board.id);
          stopped.push(board.id);
        }
        if (sim.boards.length === 0) {
          const { useElectricalStore } = await import('../store/useElectricalStore');
          useElectricalStore.getState().setPaused(true);
        }
      }
      return JSON.stringify({ success: true, stopped, message: 'Simulation stopped' });
    }
    case 'reset_simulation': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      sim.resetBoard(board.id);
      return JSON.stringify({ success: true, board_id: board.id, message: 'Board and serial output reset' });
    }
    case 'get_simulation_output': {
      const sim = useSimulatorStore.getState();
      const waitMs = Number(args.wait_ms ?? 0);
      const observed = waitMs > 0
        ? await observeBoard(sim, args.board_id, waitMs, signal)
        : { ...boardOutput(sim, args.board_id), waited_ms: 0 };
      const boards = useSimulatorStore.getState().boards.map((b: MutableState) => ({
        id: b.id,
        kind: b.boardKind,
        running: Boolean(b.running),
        compiled: Boolean(b.compiledProgram),
        serial_length: b.serialOutput?.length ?? 0,
        serial_output: tail(b.serialOutput, 4000),
      }));
      return JSON.stringify({
        active_board_id: sim.activeBoardId,
        serial_output: observed.serial_output,
        serial_length: observed.serial_length,
        running: observed.running,
        waited_ms: observed.waited_ms,
        baud_rate: sim.serialBaudRate,
        crash_board_id: observed.crash_board_id,
        boards,
      });
    }
    case 'verify_circuit': {
      const { verifyCircuit } = await import('../simulation/verify/circuitVerifier');
      const { buildInputFromStore } = await import('../simulation/spice/storeAdapter');
      const { BOARD_PIN_GROUPS } = await import('../simulation/spice/boardPinGroups');

      const sim = useSimulatorStore.getState();
      const boards = sim.boards.map((b: MutableState) => {
        const group = (BOARD_PIN_GROUPS as Record<string, MutableState>)[b.boardKind] ?? BOARD_PIN_GROUPS.default;
        const wired = new Set<string>();
        for (const w of sim.wires) {
          if (w.start.componentId === b.id) wired.add(w.start.pinName);
          if (w.end.componentId === b.id) wired.add(w.end.pinName);
        }
        const pinStates: Record<string, MutableState> = {};
        for (const pinName of wired) {
          if (group.gnd.includes(pinName) || group.vcc_pins.includes(pinName)) continue;
          const pinNumber = Number.parseInt(pinName, 10);
          if (Number.isNaN(pinNumber)) continue;
          pinStates[pinName] = { type: 'digital', v: group.vcc };
        }
        return { id: b.id, boardKind: b.boardKind, pinStates };
      });
      const snapshot = {
        components: sim.components.map((c: MutableState) => ({
          id: c.id,
          metadataId: c.metadataId,
          properties: c.properties ?? c.attrs ?? {},
        })),
        wires: sim.wires,
        boards,
      };
      const result = await verifyCircuit(buildInputFromStore(snapshot));
      return JSON.stringify({
        components_checked: result.componentsChecked,
        errors: result.errors,
        warnings: result.warnings,
      });
    }
    case 'get_circuit_state': {
      const sim = useSimulatorStore.getState();
      const audit = currentAudit(sim);
      return JSON.stringify({
        active_board_id: sim.activeBoardId,
        wiring_complete: audit.complete,
        wiring_issue_count: audit.blocking_issues.length,
        boards: sim.boards.map((b: MutableState) => ({
          id: b.id,
          kind: b.boardKind,
          x: b.x,
          y: b.y,
          running: Boolean(b.running),
          compiled: Boolean(b.compiledProgram),
          serial_length: b.serialOutput?.length ?? 0,
        })),
        components: sim.components.map((c: MutableState) => ({
          id: c.id,
          type: c.metadataId,
          x: c.x ?? c.left,
          y: c.y ?? c.top,
          properties: c.properties ?? c.attrs ?? {},
        })),
        wires: sim.wires.map((w: MutableState) => ({
          id: w.id,
          from_part: w.start.componentId,
          from_pin: w.start.pinName,
          to_part: w.end.componentId,
          to_pin: w.end.pinName,
          color: w.color,
        })),
      });
    }
    case 'get_compile_output': {
      const logs = useCompileLogsStore.getState().logs;
      return JSON.stringify({
        logs: logs.slice(-50).map((l: MutableState) => ({
          timestamp: l.timestamp,
          type: l.type,
          message: tail(l.message, 2000),
          target: l.target?.label ?? null,
        })),
      });
    }
    case 'update_code': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      const filename = typeof args.filename === 'string' ? args.filename.trim() : '';
      if (!filename) return JSON.stringify({ error: 'A filename is required' });
      if (typeof args.content !== 'string') return JSON.stringify({ error: 'File content must be a string' });

      const editor = useEditorStore.getState();
      editor.setActiveGroup(board.activeFileGroupId);
      const group = useEditorStore.getState().fileGroups[board.activeFileGroupId] ?? [];
      const existing = group.find((f: MutableState) => f.name === filename);
      if (existing) {
        useEditorStore.getState().setFileContent(existing.id, args.content);
      } else {
        const id = useEditorStore.getState().createFile(filename);
        useEditorStore.getState().setFileContent(id, args.content);
      }
      return JSON.stringify({ success: true, board_id: board.id, filename, created: !existing });
    }
    case 'read_code': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      const editor = useEditorStore.getState();
      const files = filesForBoard(editor, board);
      if (args.filename) {
        const file = files.find((f) => f.name === args.filename);
        if (!file) return JSON.stringify({ error: `File not found: ${args.filename}` });
        return JSON.stringify({ board_id: board.id, filename: file.name, content: file.content });
      }
      return JSON.stringify({ board_id: board.id, active_file_id: editor.activeFileId, files });
    }
    case 'check_environment': {
      const { scanDependencies } = await import('../services/dependencyChecker');
      const { BOARD_KIND_FQBN, isStm32BoardKind } = await import('../types/board');
      const { getInstalledLibraries } = await import('../services/libraryService');

      const dependencies = await scanDependencies();
      let libraries: string[] = [];
      try {
        libraries = (await getInstalledLibraries()).map((lib: MutableState) => lib.library?.name ?? lib.name ?? '').filter(Boolean);
      } catch {
        libraries = [];
      }

      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      const suggested: string[] = [];
      if (board) {
        if (isEsp32Kind(board.boardKind)) suggested.push('qemu-esp32');
        if (isStm32BoardKind(board.boardKind)) suggested.push('qemu-stm32');
        const fqbn = (BOARD_KIND_FQBN as Record<string, string | null>)[board.boardKind];
        if (fqbn) suggested.push('arduino-core');
      }

      return JSON.stringify({
        dependencies: dependencies.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status,
          required: d.required,
          notes: d.notes ?? null,
        })),
        installed_libraries: libraries,
        board: board ? { id: board.id, kind: board.boardKind, language: board.languageMode } : null,
        suggested_install: [...new Set(suggested)],
      });
    }
    case 'install_firmware': {
      const component = String(args.component ?? '');
      const { installArduinoCore, installQemuRuntime, autoInstallForBoard } = await import('../services/componentInstaller');
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      let success = false;
      let message = '';

      switch (component) {
        case 'qemu-esp32':
          success = await raceAbort(installQemuRuntime('esp32'), signal);
          message = success ? 'ESP32 QEMU runtime installed' : 'ESP32 QEMU install failed or requires the desktop app';
          break;
        case 'qemu-stm32':
          success = await raceAbort(installQemuRuntime('stm32'), signal);
          message = success ? 'STM32 QEMU runtime installed' : 'STM32 QEMU install failed or requires the desktop app';
          break;
        case 'arduino-core': {
          let core = typeof args.core === 'string' ? args.core : '';
          if (!core && board) {
            const { BOARD_KIND_FQBN } = await import('../types/board');
            const fqbn = (BOARD_KIND_FQBN as Record<string, string | null>)[board.boardKind];
            if (fqbn) core = fqbn.split(':').slice(0, 2).join(':');
          }
          if (!core) return JSON.stringify({ error: 'Provide a core identifier such as arduino:avr when no board is selected' });
          success = await raceAbort(installArduinoCore(core), signal);
          message = success ? `Installed Arduino core ${core}` : `Failed to install Arduino core ${core}`;
          break;
        }
        case 'micropython': {
          if (!board) return JSON.stringify({ error: 'A board is required to install MicroPython firmware' });
          if (isEsp32Kind(board.boardKind)) {
            const { getEsp32Firmware } = await import('../simulation/Esp32MicroPythonLoader');
            await raceAbort(getEsp32Firmware(board.boardKind), signal);
          } else {
            const { getFirmware } = await import('../simulation/MicroPythonLoader');
            await raceAbort(getFirmware(), signal);
          }
          success = true;
          message = 'MicroPython firmware downloaded and cached';
          break;
        }
        case 'all-for-board': {
          if (!board) return JSON.stringify({ error: 'A board is required for all-for-board installation' });
          await raceAbort(autoInstallForBoard(board.boardKind), signal);
          success = true;
          message = `Installed runtimes and core required by ${board.boardKind}`;
          break;
        }
        default:
          return JSON.stringify({
            error: 'Unknown component. Use qemu-esp32, qemu-stm32, arduino-core, micropython, or all-for-board.',
          });
      }
      return JSON.stringify({ success, component, board_id: board?.id ?? null, message });
    }
    case 'set_board_language': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      const mode = args.mode === 'micropython' ? 'micropython' : args.mode === 'arduino' ? 'arduino' : null;
      if (!mode) return JSON.stringify({ error: 'Mode must be arduino or micropython' });
      sim.setBoardLanguageMode(board.id, mode);
      const updated = useSimulatorStore.getState().boards.find((b: MutableState) => b.id === board.id);
      if (updated?.languageMode !== mode) {
        return JSON.stringify({ error: `Board ${board.boardKind} does not support ${mode}` });
      }
      return JSON.stringify({ success: true, board_id: board.id, mode });
    }
    case 'search_libraries': {
      const { searchLibraries } = await import('../services/libraryService');
      try {
        const libraries = await searchLibraries(String(args.query ?? ''));
        return JSON.stringify({ libraries: libraries.slice(0, 20).map((lib: MutableState) => ({
          name: lib.name,
          version: lib.latest?.version ?? null,
          sentence: lib.latest?.sentence ?? lib.sentence ?? null,
        })) });
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    case 'install_library': {
      const { installLibrary } = await import('../services/libraryService');
      const name = String(args.name ?? '').trim();
      if (!name) return JSON.stringify({ error: 'A library name is required' });
      try {
        const result = await raceAbort(
          installLibrary(name, typeof args.version === 'string' ? args.version : undefined),
          signal,
        );
        return JSON.stringify({ success: Boolean(result.success), library: name, result });
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    case 'get_installed_libraries': {
      const { getInstalledLibraries } = await import('../services/libraryService');
      try {
        const libraries = await getInstalledLibraries();
        return JSON.stringify({ libraries: libraries.map((lib: MutableState) => ({
          name: lib.library?.name ?? lib.name ?? '',
          version: lib.library?.version ?? lib.version ?? null,
          custom: Boolean(lib.custom),
        })) });
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    case 'delegate_to_subagent': {
      const { createProvider } = await import('./providers/registry');
      const { useProviderStore } = await import('../store/useProviderStore');
      const { resolveSubAgentRole, SUBAGENT_PROMPTS } = await import('./subagents');

      const task = String(args.task ?? '').trim();
      if (!task) return JSON.stringify({ error: 'A task description is required' });

      const store = useProviderStore.getState();
      const config = store.providers[store.activeProviderId];
      const provider = createProvider(config);
      if (!provider) return JSON.stringify({ error: `No usable provider for ${config.name}` });

      const role = resolveSubAgentRole(String(args.role ?? 'planner'));
      const sim = useSimulatorStore.getState();
      const context = JSON.stringify({
        boards: sim.boards.map((b: MutableState) => ({ id: b.id, kind: b.boardKind })),
        components: sim.components.map((c: MutableState) => ({ id: c.id, type: c.metadataId, properties: c.properties })),
        wires: sim.wires.map((w: MutableState) => ({
          from: `${w.start.componentId}:${w.start.pinName}`,
          to: `${w.end.componentId}:${w.end.pinName}`,
        })),
      });

      const reply = await raceAbort(
        provider.chat({
          messages: [
            { id: 'sub-system', role: 'system', content: SUBAGENT_PROMPTS[role], timestamp: Date.now() },
            {
              id: 'sub-task',
              role: 'user',
              content: `Task: ${task}\nCurrent circuit: ${context}`,
              timestamp: Date.now(),
            },
          ],
          model: config.model,
          signal,
        }),
        signal,
      );

      return JSON.stringify({ success: true, role, response: reply.content });
    }
    case 'list_uploaded_files': {
      const { useUploadsStore } = await import('../store/useUploadsStore');
      const files = useUploadsStore.getState().files.map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        size: f.size,
        text_length: f.text?.length ?? 0,
        width: f.width ?? null,
        height: f.height ?? null,
        error: f.error ?? null,
      }));
      return JSON.stringify({ files });
    }
    case 'read_uploaded_file': {
      const { useUploadsStore } = await import('../store/useUploadsStore');
      const files = useUploadsStore.getState().files;
      const selected = args.name
        ? files.filter(f => f.name === args.name)
        : files;
      if (selected.length === 0) {
        return JSON.stringify({ error: `File not found: ${args.name ?? '(none attached)'}` });
      }
      const includeData = args.include_data === true;
      const output = selected.map(f => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        text: f.text ?? null,
        ...(includeData && f.dataUrl ? { data_url: f.dataUrl } : {}),
        width: f.width ?? null,
        height: f.height ?? null,
        error: f.error ?? null,
      }));
      return JSON.stringify({ files: output });
    }
    case 'list_available_boards': {
      return JSON.stringify({
        boards: [
          { kind: 'arduino-uno', name: 'Arduino Uno (ATmega328P)' },
          { kind: 'arduino-nano', name: 'Arduino Nano (ATmega328P)' },
          { kind: 'arduino-mega', name: 'Arduino Mega 2560 (ATmega2560)' },
          { kind: 'esp32', name: 'ESP32 DevKit (Xtensa dual-core)' },
          { kind: 'esp32-s3', name: 'ESP32-S3 DevKit' },
          { kind: 'esp32-c3', name: 'ESP32-C3 (RISC-V)' },
          { kind: 'raspberry-pi-pico', name: 'Raspberry Pi Pico (RP2040)' },
          { kind: 'pi-pico-w', name: 'Raspberry Pi Pico W (RP2040 + WiFi)' },
          { kind: 'stm32-bluepill', name: 'STM32 Blue Pill (STM32F103C8T6)' },
          { kind: 'attiny85', name: 'ATtiny85' },
        ],
      });
    }
    case 'list_available_components': {
      const metadata = await loadComponentMetadata();
      const seen = new Set<string>();
      const components: Array<Record<string, unknown>> = [];
      for (const hint of COMPONENT_HINTS) {
        const resolved = resolveComponentType(hint.hint, metadata);
        if (!resolved || seen.has(resolved.id)) continue;
        seen.add(resolved.id);
        components.push({
          type: resolved.id,
          name: resolved.name,
          pins: hint.pins,
          defaultAttrs: hint.defaultAttrs ?? {},
        });
      }
      return JSON.stringify({ components });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
