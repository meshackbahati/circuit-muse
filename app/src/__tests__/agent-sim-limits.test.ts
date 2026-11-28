// @vitest-environment jsdom
/**
 * The agent must (1) be told which parts an ESP32 in QEMU cannot exercise,
 * by id, so it stops rewiring an HC-SR04 whose echo is never simulated, and
 * (2) never read the previous firmware's serial output after a new compile.
 */
import { describe, expect, it, vi } from 'vitest';
import { getExampleById } from '../data/examples';
import { loadExample } from '../utils/loadExample';
import { executeToolCall } from '../agent/toolExecutor';
import { useSimulatorStore, getEsp32Bridge } from '../store/useSimulatorStore';

vi.mock('../services/compilation', () => ({
  compileCode: vi.fn(async () => ({ success: true, binary_content: 'AAAA', stdout: 'ok' })),
}));

const call = async (name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(await executeToolCall({ id: 't', type: 'function', function: { name, arguments: JSON.stringify(args) } }));

describe('agent and simulator limits', () => {
  it('names the HC-SR04 as untestable once the emulator reports limits', async () => {
    await loadExample(getExampleById('esp32-hcsr04')!);
    const state = useSimulatorStore.getState();
    const board = state.boards[0];
    const bridge = getEsp32Bridge(board.id);
    expect(bridge, 'example uses an ESP32 bridge').toBeTruthy();
    bridge!.limitations = ['Signals into the ESP32 are not simulated'];

    const s = await call('get_circuit_state');
    const sensor = state.components.find((c) => /sr04/i.test(c.metadataId));
    expect(s.simulator_limitations.affected_parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sensor!.id, board_id: board.id })]),
    );
    bridge!.limitations = [];
  });

  it('restarts a running board on compile and drops the old serial output', async () => {
    await loadExample(getExampleById('esp32-hcsr04')!);
    const board = useSimulatorStore.getState().boards[0];
    useSimulatorStore.setState((s) => ({
      boards: s.boards.map((b) =>
        b.id === board.id ? { ...b, running: true, serialOutput: 'echo HIGH samples: 0\n' } : b,
      ),
      serialOutput: 'echo HIGH samples: 0\n',
    }));
    const stop = vi.spyOn(useSimulatorStore.getState(), 'stopBoard');
    const start = vi.spyOn(useSimulatorStore.getState(), 'startBoard');

    const r = await call('compile_code', { board_id: board.id, observe_ms: 50 });
    expect(r.success).toBe(true);
    expect(r.restarted_with_new_firmware).toBe(true);
    expect(stop).toHaveBeenCalledWith(board.id);
    expect(start).toHaveBeenCalledWith(board.id);
    expect(r.run.serial_output).not.toContain('echo HIGH samples');
  });
});
