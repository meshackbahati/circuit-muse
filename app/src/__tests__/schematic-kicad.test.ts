import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exampleProjects, getExampleById } from '../data/examples';
import { exportKicad, q, num, uuidFrom } from '../schematic/kicad';
import type { SchematicNetlist } from '../schematic/netlist';
import { exampleToSchematicInput, parseSExpr, children, child, type SExpr } from './schematic-helpers';

const str = (e: SExpr | undefined, i: number): string => (Array.isArray(e) ? String(e[i]) : '');
const fl = (e: SExpr | undefined, i: number): number => Number(str(e, i));
const pt = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;

interface LibPin {
  number: string;
  x: number;
  y: number;
}

/**
 * Re-derive connectivity from the .kicad_sch text alone, the way KiCad does:
 * pin end points (from the embedded lib_symbols) → wire stubs → global
 * labels / power symbols. Returns "REF.pin" → net name (null = no-connect).
 */
function connectivityFromSchematic(text: string): Map<string, string | null> {
  const root = parseSExpr(text);
  expect(Array.isArray(root) && root[0]).toBe('kicad_sch');
  const libs = new Map<string, LibPin[]>();
  for (const sym of children(child(root, 'lib_symbols')!, 'symbol')) {
    const pins: LibPin[] = [];
    for (const unit of children(sym, 'symbol')) {
      for (const p of children(unit, 'pin')) {
        const at = child(p, 'at');
        pins.push({ number: str(child(p, 'number'), 1), x: fl(at, 1), y: fl(at, 2) });
      }
    }
    libs.set(str(sym, 1), pins);
  }

  const wireEnds = new Map<string, string[]>();
  for (const w of children(root, 'wire')) {
    const xy = children(child(w, 'pts')!, 'xy');
    expect(xy.length).toBe(2);
    const a = pt(fl(xy[0], 1), fl(xy[0], 2));
    const b = pt(fl(xy[1], 1), fl(xy[1], 2));
    wireEnds.set(a, [...(wireEnds.get(a) ?? []), b]);
    wireEnds.set(b, [...(wireEnds.get(b) ?? []), a]);
  }
  const labels = new Map<string, string>();
  for (const l of children(root, 'global_label')) {
    const at = child(l, 'at');
    labels.set(pt(fl(at, 1), fl(at, 2)), str(l, 1));
  }
  const noConnects = new Set(children(root, 'no_connect').map((n) => pt(fl(child(n, 'at'), 1), fl(child(n, 'at'), 2))));

  interface Inst {
    libId: string;
    ref: string;
    value: string;
    pins: Array<{ number: string; key: string }>;
  }
  const insts: Inst[] = [];
  for (const s of children(root, 'symbol')) {
    const libId = str(child(s, 'lib_id'), 1);
    const lib = libs.get(libId);
    expect(lib, `lib_symbols has ${libId}`).toBeTruthy();
    const at = child(s, 'at');
    const x = fl(at, 1);
    const y = fl(at, 2);
    const rot = (fl(at, 3) * Math.PI) / 180;
    const c = Math.round(Math.cos(rot));
    const si = Math.round(Math.sin(rot));
    const props = children(s, 'property');
    const prop = (name: string) => str(props.find((p) => p[1] === name), 2);
    // Every lib pin is listed on the instance.
    const instPins = children(s, 'pin').map((p) => str(p, 1));
    expect(instPins.sort()).toEqual(lib!.map((p) => p.number).sort());
    insts.push({
      libId,
      ref: prop('Reference'),
      value: prop('Value'),
      pins: lib!.map((p) => ({ number: p.number, key: pt(x + p.x * c - p.y * si, y - (p.x * si + p.y * c)) })),
    });
  }
  // PWR_FLAG markers sit on a power symbol's pin on purpose (ERC: the rail
  // is driven); they carry no net name of their own.
  const flags = insts.filter((i) => i.libId === 'power:PWR_FLAG');
  const placed = insts.filter((i) => i.libId !== 'power:PWR_FLAG');
  const powerAt = new Map<string, string>();
  for (const i of placed) if (i.libId.startsWith('power:')) powerAt.set(i.pins[0].key, i.value);
  for (const f of flags) {
    expect(powerAt.has(f.pins[0].key), 'PWR_FLAG sits on a power symbol pin').toBe(true);
  }
  expect(new Set(flags.map((f) => powerAt.get(f.pins[0].key))).size, 'one PWR_FLAG per power net').toBe(flags.length);
  expect(flags.length, 'every power net is flagged').toBe(new Set(powerAt.values()).size);

  // No accidental connections: every connection point is distinct, and none
  // sits on the inside of a wire segment (KiCad would join it there).
  const points: string[] = [
    ...placed.flatMap((i) => i.pins.map((p) => p.key)),
    ...labels.keys(),
  ];
  expect(new Set(points).size, 'connection points are unique').toBe(points.length);
  const segs = children(root, 'wire').map((w) => children(child(w, 'pts')!, 'xy').map((xy) => [fl(xy, 1), fl(xy, 2)]));
  for (const key of new Set([...points, ...noConnects])) {
    const [px, py] = key.split(',').map((v) => Number(v) / 1000);
    for (const [[x1, y1], [x2, y2]] of segs) {
      const onLine = Math.abs((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) < 1e-6;
      const inside =
        onLine &&
        px >= Math.min(x1, x2) - 1e-6 &&
        px <= Math.max(x1, x2) + 1e-6 &&
        py >= Math.min(y1, y2) - 1e-6 &&
        py <= Math.max(y1, y2) + 1e-6 &&
        pt(px, py) !== pt(x1, y1) &&
        pt(px, py) !== pt(x2, y2);
      expect(inside, `${key} lies inside a wire`).toBe(false);
    }
  }

  const out = new Map<string, string | null>();
  for (const i of insts) {
    if (i.libId.startsWith('power:')) continue;
    for (const p of i.pins) {
      const id = `${i.ref}.${p.number}`;
      if (noConnects.has(p.key)) {
        expect(wireEnds.has(p.key), `${id} is both NC and wired`).toBe(false);
        out.set(id, null);
        continue;
      }
      const ends = wireEnds.get(p.key);
      expect(ends?.length, `${id} has a wire stub or a no-connect`).toBe(1);
      const far = ends![0];
      const name = labels.get(far) ?? powerAt.get(far);
      expect(name, `${id} stub ends on a label or power symbol`).toBeTruthy();
      out.set(id, name!);
    }
  }
  return out;
}

function netsFromNetlistFile(text: string): Map<string, string[]> {
  const root = parseSExpr(text);
  expect(Array.isArray(root) && root[0]).toBe('export');
  const nets = new Map<string, string[]>();
  for (const n of children(child(root, 'nets')!, 'net')) {
    const nodes = children(n, 'node').map((nd) => `${str(child(nd, 'ref'), 1)}.${str(child(nd, 'pin'), 1)}`);
    nets.set(str(child(n, 'name'), 1), nodes.sort());
  }
  return nets;
}

function expectedPins(nl: SchematicNetlist): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const p of nl.parts) for (const pin of p.pins) m.set(`${p.ref}.${pin.number}`, pin.net);
  return m;
}

describe('KiCad export helpers', () => {
  it('escapes strings and formats numbers', () => {
    expect(q('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(q('line1\nline2')).toBe('"line1\\nline2"');
    expect(num(-0)).toBe('0');
    expect(num(1.270000001)).toBe('1.27');
    expect(uuidFrom('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFrom('x')).toBe(uuidFrom('x'));
    expect(uuidFrom('x')).not.toBe(uuidFrom('y'));
  });

  it('survives hostile names (quotes, backslashes, parentheses)', () => {
    const b = exportKicad(
      {
        boards: [{ id: 'arduino-uno', boardKind: 'arduino-uno', name: 'My "best" (uno) \\ board' }],
        components: [{ id: 'x', metadataId: 'weird"(part)', properties: {} }],
        wires: [{ start: { componentId: 'x', pinName: 'P("1")' }, end: { componentId: 'arduino-uno', pinName: '2' } }],
      },
      { projectName: 'te"st (1)' },
    );
    expect(() => parseSExpr(b.schematic)).not.toThrow();
    expect(() => parseSExpr(b.netlist)).not.toThrow();
    const conn = connectivityFromSchematic(b.schematic);
    expect([...conn.values()]).toContain('D2');
  });
});

describe('KiCad export — every example', () => {
  it('schematic and netlist files parse and match netlist.ts exactly', () => {
    let n = 0;
    for (const ex of exampleProjects) {
      const bundle = exportKicad(exampleToSchematicInput(ex), { projectName: ex.id, date: '2026-01-01T00:00:00Z' });
      // Schematic: balanced, all symbols embedded, every pin labelled or NC,
      // and the connectivity KiCad would see equals ours.
      const conn = connectivityFromSchematic(bundle.schematic);
      const expected = expectedPins(bundle.data);
      expect(conn, ex.id).toEqual(expected);
      // Netlist file nets equal netlist.ts nets.
      const fileNets = netsFromNetlistFile(bundle.netlist);
      const ours = new Map(bundle.data.nets.map((net) => [net.name, net.nodes.map((x) => `${x.ref}.${x.pin}`).sort()]));
      expect(fileNets, ex.id).toEqual(ours);
      // Project file is JSON.
      expect(() => JSON.parse(bundle.project)).not.toThrow();
      n++;
    }
    expect(n).toBeGreaterThan(200);
  }, 180_000);

  it('is byte-for-byte deterministic', () => {
    const ex = getExampleById('traffic-light')!;
    const a = exportKicad(exampleToSchematicInput(ex), { projectName: 'p', date: 'd' });
    const b = exportKicad(exampleToSchematicInput(ex), { projectName: 'p', date: 'd' });
    expect(a.schematic).toBe(b.schematic);
    expect(a.netlist).toBe(b.netlist);
  });

  it('uses standard KiCad symbols and power symbols for the blink circuit', () => {
    const b = exportKicad(exampleToSchematicInput(getExampleById('traffic-light')!), { projectName: 'tl' });
    expect(b.schematic).toContain('(symbol "Device:R"');
    expect(b.schematic).toContain('(symbol "Device:LED"');
    expect(b.schematic).toContain('(symbol "power:GND" (power)');
    expect(b.schematic).toMatch(/\(kicad_sch \(version 20231120\) \(generator "circuitmuse"\)/);
    expect(b.netlist).toContain('(export (version "E")');
  });
});

// Optional: prove KiCad itself parses the file when kicad-cli is installed.
const kicadCli = (() => {
  try {
    return execSync('command -v kicad-cli', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();

describe.skipIf(!kicadCli)('kicad-cli round trip', () => {
  it('kicad-cli exports a netlist from the generated schematic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-kicad-'));
    const b = exportKicad(exampleToSchematicInput(getExampleById('traffic-light')!), { projectName: 'tl' });
    writeFileSync(join(dir, 'tl.kicad_sch'), b.schematic);
    writeFileSync(join(dir, 'tl.kicad_pro'), b.project);
    execFileSync(kicadCli, ['sch', 'export', 'netlist', '-o', join(dir, 'out.net'), join(dir, 'tl.kicad_sch')]);
    expect(existsSync(join(dir, 'out.net'))).toBe(true);
    const nets = netsFromNetlistFile(readFileSync(join(dir, 'out.net'), 'utf8'));
    for (const net of b.data.nets) {
      const nodes = net.nodes.map((x) => `${x.ref}.${x.pin}`).sort();
      const match = [...nets.values()].some((v) => JSON.stringify(v) === JSON.stringify(nodes));
      expect(match, net.name).toBe(true);
    }
  });
});
