/**
 * The agent must be able to complete a build-and-verify cycle, so the tool
 * catalogue is checked for every stage and the state-backed tools are exercised
 * against the real stores rather than fixtures.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../agent/toolDefs';
import { executeToolCall } from '../agent/toolExecutor';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { ToolCall } from '../agent/types';

function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const toolCall: ToolCall = {
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
  return executeToolCall(toolCall);
}

function addBoard(): string {
  return useSimulatorStore.getState().addBoard('arduino-uno', 200, 200);
}

describe('agent tool catalogue', () => {
  it('has one unique definition per tool', () => {
    const names = AGENT_TOOLS.map(t => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers inspection, construction, code, verification and runtime stages', () => {
    const names = AGENT_TOOLS.map(t => t.function.name);
    for (const required of [
      'get_circuit_state',
      'get_pin_names',
      'add_board',
      'add_component',
      'wire_components',
      'read_code',
      'update_code',
      'verify_circuit',
      'compile_code',
      'run_simulation',
      'get_simulation_output',
      'reset_simulation',
      'set_component_property',
      'remove_wire',
      'remove_component',
      'check_environment',
      'install_firmware',
      'install_library',
      'get_installed_libraries',
      'search_libraries',
      'set_board_language',
    ]) {
      expect(names).toContain(required);
    }
  });
});

describe('state-backed agent tools', () => {
  it('creates and then reads a file in the target board workspace', async () => {
    const boardId = addBoard();
    const filename = `agent-test-${Date.now()}.ino`;
    const written = JSON.parse(await call('update_code', {
      board_id: boardId,
      filename,
      content: 'void setup() { Serial.begin(9600); }',
    }));
    expect(written).toMatchObject({ success: true, board_id: boardId, filename, created: true });

    const read = JSON.parse(await call('read_code', { board_id: boardId, filename }));
    expect(read.content).toBe('void setup() { Serial.begin(9600); }');
  });

  it('refuses to run a board that has not compiled', async () => {
    const boardId = addBoard();
    const result = JSON.parse(await call('run_simulation', { board_id: boardId }));
    expect(result.error).toMatch(/compile_code/);
  });

  it('reports serial output and compiled state for every board', async () => {
    const result = JSON.parse(await call('get_simulation_output'));
    expect(result).toHaveProperty('serial_output');
    expect(Array.isArray(result.boards)).toBe(true);
    expect(result.boards[0]).toHaveProperty('compiled');
  });

  it('reads canvas component ids and properties through get_circuit_state', async () => {
    const boardId = addBoard();
    const added = JSON.parse(await call('add_component', { type: 'wokwi-resistor', x: 100, y: 100, attrs: { value: '220' } }));
    const state = JSON.parse(await call('get_circuit_state'));
    expect(state.active_board_id).toBeTruthy();
    expect(state.boards.some((b: { id: string }) => b.id === boardId)).toBe(true);
    const component = state.components.find((c: { id: string }) => c.id === added.component_id);
    expect(component.properties.value).toBe('220');

    const updated = JSON.parse(await call('set_component_property', {
      component_id: added.component_id,
      name: 'value',
      value: '330',
    }));
    expect(updated).toMatchObject({ success: true, value: '330' });
  });

  it('rejects an unknown firmware component with the supported values', async () => {
    const result = JSON.parse(await call('install_firmware', { component: 'not-a-runtime' }));
    expect(result.error).toMatch(/qemu-esp32/);
  });

  it('reports missing pin data without a rendered canvas part', async () => {
    const result = JSON.parse(await call('get_pin_names', { part_id: 'not-on-canvas' }));
    expect(result.error).toMatch(/get_circuit_state/);
  });
});
