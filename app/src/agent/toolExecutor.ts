import type { ToolCall } from './types';

type MutableState = any;

function tail(text: string | undefined, max = 4000): string {
  if (!text) return '';
  return text.length > max ? text.slice(-max) : text;
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

/** Translate convenient tool aliases into the ids the canvas can render. */
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

export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(argsStr);
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments' });
  }

  const { useSimulatorStore } = await import('../store/useSimulatorStore');
  const { useCompileLogsStore } = await import('../store/useCompileLogsStore');
  const { useEditorStore } = await import('../store/useEditorStore');

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
    case 'remove_component': {
      const sim = useSimulatorStore.getState();
      if (!sim.components.some((c: MutableState) => c.id === args.component_id)) {
        return JSON.stringify({ error: `Component not found: ${args.component_id}` });
      }
      sim.recordRemoveComponent(args.component_id);
      return JSON.stringify({ success: true });
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
      for (const id of [args.from_part, args.to_part]) {
        if (!known.has(id)) return JSON.stringify({ error: `Part not found on canvas: ${id}` });
      }
      const wire = {
        id: `wire-${Date.now()}`,
        start: { componentId: args.from_part, pinId: args.from_pin },
        end: { componentId: args.to_part, pinId: args.to_pin },
        color: args.color ?? 'green',
        waypoints: [],
      } as any;
      sim.recordAddWire(wire);
      return JSON.stringify({ success: true, wire_id: wire.id });
    }
    case 'remove_wire': {
      const sim = useSimulatorStore.getState();
      if (!sim.wires.some((w: MutableState) => w.id === args.wire_id)) {
        return JSON.stringify({ error: `Wire not found: ${args.wire_id}` });
      }
      sim.recordRemoveWire(args.wire_id);
      return JSON.stringify({ success: true });
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
    case 'compile_code': {
      const { compileCode } = await import('../services/compilation');
      const { BOARD_KIND_FQBN } = await import('../types/board');
      const { parseCompileResult } = await import('../utils/compilationLogger');

      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      const fqbn = (BOARD_KIND_FQBN as Record<string, string | null>)[board.boardKind];
      if (!fqbn) return JSON.stringify({ error: `No compiler target for board kind ${board.boardKind}` });

      const editor = useEditorStore.getState();
      const files = filesForBoard(editor, board);
      if (files.length === 0) return JSON.stringify({ error: 'No source files to compile' });

      let result: MutableState;
      try {
        result = await compileCode(files, fqbn, null);
      } catch (error) {
        return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
      }

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
      return JSON.stringify({
        success: true,
        board_id: board.id,
        board_kind: board.boardKind,
        message: 'Compilation successful; firmware loaded into the board',
        stdout_tail: tail(result.stdout, 2000),
      });
    }
    case 'run_simulation': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      if (!board.compiledProgram) {
        return JSON.stringify({
          error: `Board ${board.id} has no compiled firmware. Call compile_code before run_simulation.`,
        });
      }
      if (args.board_id) sim.startBoard(board.id);
      else sim.startSimulation();
      const running = useSimulatorStore.getState().boards.find((b: MutableState) => b.id === board.id)?.running ?? false;
      return JSON.stringify({
        success: true,
        board_id: board.id,
        running,
        message: running ? 'Simulation running' : 'Start requested; check get_simulation_output for state',
      });
    }
    case 'stop_simulation': {
      const sim = useSimulatorStore.getState();
      const board = resolveBoard(sim, args.board_id);
      if (!board) return JSON.stringify({ error: `Board not found: ${args.board_id ?? '(active)'}` });
      if (args.board_id) sim.stopBoard(board.id);
      else sim.stopSimulation();
      return JSON.stringify({ success: true, board_id: board.id, message: 'Simulation stopped' });
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
      const boards = sim.boards.map((b: MutableState) => ({
        id: b.id,
        kind: b.boardKind,
        running: Boolean(b.running),
        compiled: Boolean(b.compiledProgram),
        serial_output: tail(b.serialOutput, 4000),
      }));
      return JSON.stringify({
        active_board_id: sim.activeBoardId,
        serial_output: tail(sim.serialOutput, 4000),
        baud_rate: sim.serialBaudRate,
        crash_board_id: sim.esp32CrashBoardId,
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
      return JSON.stringify({
        active_board_id: sim.activeBoardId,
        boards: sim.boards.map((b: MutableState) => ({
          id: b.id,
          kind: b.boardKind,
          x: b.x,
          y: b.y,
          running: Boolean(b.running),
          compiled: Boolean(b.compiledProgram),
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
          success = await installQemuRuntime('esp32');
          message = success ? 'ESP32 QEMU runtime installed' : 'ESP32 QEMU install failed or requires the desktop app';
          break;
        case 'qemu-stm32':
          success = await installQemuRuntime('stm32');
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
          success = await installArduinoCore(core);
          message = success ? `Installed Arduino core ${core}` : `Failed to install Arduino core ${core}`;
          break;
        }
        case 'micropython': {
          if (!board) return JSON.stringify({ error: 'A board is required to install MicroPython firmware' });
          if (isEsp32Kind(board.boardKind)) {
            const { getEsp32Firmware } = await import('../simulation/Esp32MicroPythonLoader');
            await getEsp32Firmware(board.boardKind);
          } else {
            const { getFirmware } = await import('../simulation/MicroPythonLoader');
            await getFirmware();
          }
          success = true;
          message = 'MicroPython firmware downloaded and cached';
          break;
        }
        case 'all-for-board': {
          if (!board) return JSON.stringify({ error: 'A board is required for all-for-board installation' });
          await autoInstallForBoard(board.boardKind);
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
        const result = await installLibrary(name, typeof args.version === 'string' ? args.version : undefined);
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
