import type { ToolCall } from './types';

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
      return JSON.stringify({ success: true, board_id: id });
    }
    case 'remove_board': {
      const sim = useSimulatorStore.getState();
      sim.removeBoard(args.board_id);
      return JSON.stringify({ success: true });
    }
    case 'add_component': {
      const sim = useSimulatorStore.getState();
      const component = {
        id: `comp-${Date.now()}`,
        metadataId: args.type,
        left: args.x ?? 200,
        top: args.y ?? 200,
        rotate: args.rotation ?? 0,
        attrs: args.attrs ?? {},
      };
      sim.recordAddComponent(component);
      return JSON.stringify({ success: true, component_id: component.id });
    }
    case 'wire_components': {
      const sim = useSimulatorStore.getState();
      const wire = {
        id: `wire-${Date.now()}`,
        start: { componentId: args.from_part, pinId: args.from_pin },
        end: { componentId: args.to_part, pinId: args.to_pin },
        color: args.color ?? 'green',
      };
      sim.recordAddWire(wire);
      return JSON.stringify({ success: true, wire_id: wire.id });
    }
    case 'compile_code': {
      const sim = useSimulatorStore.getState();
      const board = sim.boards.find(b => b.id === args.board_id);
      if (!board) return JSON.stringify({ error: 'Board not found' });
      const editor = useEditorStore.getState();
      const files = editor.files.map(f => ({ name: f.name, content: f.content }));
      const response = await fetch('/api/compile/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, board_fqbn: board.boardKind }),
      });
      const result = await response.json();
      if (!result.success) {
        const logs = useCompileLogsStore.getState().logs;
        const errors = logs.filter((l: any) => l.level === 'error');
        return JSON.stringify({ success: false, errors: errors.map((e: any) => e.message), stderr: result.stderr });
      }
      return JSON.stringify({ success: true, message: 'Compilation successful' });
    }
    case 'run_simulation': {
      const sim = useSimulatorStore.getState();
      for (const board of sim.boards) {
        sim.startSimulation(board.id);
      }
      return JSON.stringify({ success: true, message: 'Simulation started' });
    }
    case 'get_circuit_state': {
      const sim = useSimulatorStore.getState();
      return JSON.stringify({
        boards: sim.boards.map(b => ({ id: b.id, kind: b.boardKind, x: b.x, y: b.y, running: b.running })),
        components: sim.components.map(c => ({ id: c.id, type: c.metadataId, left: c.left, top: c.top })),
        wires: sim.wires.map(w => ({ id: w.id, from: w.start, to: w.end })),
      });
    }
    case 'get_compile_output': {
      const logs = useCompileLogsStore.getState().logs;
      return JSON.stringify({ logs: logs.slice(-50) });
    }
    case 'update_code': {
      const editor = useEditorStore.getState();
      const file = editor.files.find(f => f.name === args.filename);
      if (file) {
        editor.setFileContent(file.id, args.content);
      }
      return JSON.stringify({ success: true });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
