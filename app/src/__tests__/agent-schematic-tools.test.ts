// @vitest-environment jsdom
/**
 * The agent can read the schematic (refs, nets, unconnected pins) and export
 * it to KiCad, the same data as the Schematic view.
 */
import { describe, expect, it, vi } from 'vitest';
import { getExampleById } from '../data/examples';
import { loadExample } from '../utils/loadExample';
import { executeToolCall } from '../agent/toolExecutor';
import { AGENT_TOOLS } from '../agent/toolDefs';

const call = async (name: string, args: Record<string, unknown> = {}) =>
  JSON.parse(await executeToolCall({ id: 't', type: 'function', function: { name, arguments: JSON.stringify(args) } }));

describe('agent schematic tools', () => {
  it('are offered to the model', () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toContain('get_schematic');
    expect(names).toContain('export_kicad');
  });

  it('get_schematic shows which pins share a net', async () => {
    await loadExample(getExampleById('esp32-hcsr04')!);
    const s = await call('get_schematic');
    expect(s.parts.map((p: any) => p.ref)).toEqual(expect.arrayContaining(['A1', 'U1']));
    const trig = s.nets.find((n: any) => n.nodes.some((x: string) => x === 'U1.TRIG'));
    expect(trig, 'TRIG is on a net').toBeTruthy();
    expect(trig.nodes.some((x: string) => x.startsWith('A1.') && /18/.test(x))).toBe(true);
    expect(s.nets.some((n: any) => n.power === 'GND')).toBe(true);
    expect(Array.isArray(s.single_connection_nets)).toBe(true);
  });

  it('export_kicad saves the requested file', async () => {
    await loadExample(getExampleById('esp32-hcsr04')!);
    const download = vi.fn();
    vi.doMock('../schematic/download', async (orig) => ({ ...(await orig<any>()), downloadKicad: download }));
    const r = await call('export_kicad', { format: 'kicad_sch', project_name: 'my sensor' });
    expect(r.success).toBe(true);
    expect(r.file).toMatch(/\.kicad_sch$/);
    expect(download).toHaveBeenCalledWith('kicad_sch', 'my sensor');
    vi.doUnmock('../schematic/download');
  });
});
