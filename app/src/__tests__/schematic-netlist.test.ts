import { describe, it, expect } from 'vitest';
import { exampleProjects, getExampleById } from '../data/examples';
import { buildSchematicNetlist, formatValue, type SchematicInput, type SchematicNetlist } from '../schematic/netlist';
import { layoutSchematic } from '../schematic/layout';
import { buildNetlist } from '../simulation/spice/NetlistBuilder';
import { buildInputFromStore } from '../simulation/spice/storeAdapter';
import type { BoardKind } from '../types/board';
import type { Wire } from '../types/wire';
import { exampleToSchematicInput } from './schematic-helpers';

function load(id: string): { input: SchematicInput; nl: SchematicNetlist } {
  const ex = getExampleById(id);
  if (!ex) throw new Error(`missing example ${id}`);
  const input = exampleToSchematicInput(ex);
  return { input, nl: buildSchematicNetlist(input) };
}

/** Invariants every generated netlist must satisfy. */
function checkInvariants(input: SchematicInput, nl: SchematicNetlist) {
  // Refs unique.
  const refs = nl.parts.map((p) => p.ref);
  expect(new Set(refs).size).toBe(refs.length);
  // Every wire endpoint lands in exactly one net.
  for (const w of input.wires) {
    for (const e of [w.start, w.end]) {
      const k = `${e.componentId}:${e.pinName}`;
      expect(nl.endpointNet.get(k), `endpoint ${k}`).toBeTruthy();
      const owners = nl.parts.flatMap((p) =>
        p.sourceId === e.componentId ? p.pins.filter((pin) => pin.circuitPins.includes(e.pinName)) : [],
      );
      expect(owners.length, `endpoint ${k} owned by one pin`).toBe(1);
      expect(owners[0].net).toBe(nl.endpointNet.get(k));
    }
  }
  // Each (ref, pin) appears in at most one net, and nets agree with part pins.
  const seen = new Set<string>();
  for (const net of nl.nets) {
    for (const n of net.nodes) {
      const k = `${n.ref}.${n.pin}`;
      expect(seen.has(k), `${k} in two nets`).toBe(false);
      seen.add(k);
      const part = nl.parts.find((p) => p.ref === n.ref)!;
      expect(part.pins.find((p) => p.number === n.pin)!.net).toBe(net.name);
    }
  }
  for (const p of nl.parts) {
    for (const pin of p.pins) {
      if (pin.net) expect(seen.has(`${p.ref}.${pin.number}`)).toBe(true);
    }
    // Part pins match the symbol pins one to one.
    expect(p.pins.map((x) => x.number)).toEqual(p.symbol.pins.map((x) => x.number));
  }
  // Net names unique, codes 1..N.
  expect(new Set(nl.nets.map((n) => n.name)).size).toBe(nl.nets.length);
  nl.nets.forEach((n, i) => expect(n.code).toBe(i + 1));
}

describe('schematic netlist — real examples', () => {
  it('traffic light (Uno + LEDs + resistors)', () => {
    const { input, nl } = load('traffic-light');
    checkInvariants(input, nl);
    const uno = nl.parts.find((p) => p.kind === 'board')!;
    expect(uno.ref).toBe('A1');
    expect(uno.kicadSymbol).toBe('MCU_Module:Arduino_UNO_R3');
    const leds = nl.parts.filter((p) => p.libId === 'Device:LED');
    const rs = nl.parts.filter((p) => p.libId === 'Device:R');
    expect(leds.length).toBe(3);
    expect(rs.length).toBe(3);
    expect(leds.map((l) => l.ref)).toEqual(['LED1', 'LED2', 'LED3']);
    expect(nl.nets.map((n) => n.name)).toEqual(expect.arrayContaining(['GND', 'D13', 'D12', 'D11']));
    // LED cathodes all end up on GND (directly or via resistor) and the
    // board's GND pins are a single net.
    const gnd = nl.nets.filter((n) => n.name === 'GND');
    expect(gnd.length).toBe(1);
  });

  it('BJT common-emitter (multi-part analog, no board)', () => {
    const { input, nl } = load('an-bjt-common-emitter');
    checkInvariants(input, nl);
    expect(nl.parts.some((p) => p.kind === 'board')).toBe(false);
    const q = nl.parts.find((p) => p.libId === 'Device:Q_NPN_BCE');
    expect(q?.ref).toBe('Q1');
    expect(q!.pins.every((p) => p.net)).toBe(true);
    expect(nl.parts.filter((p) => p.libId === 'Device:R').length).toBeGreaterThanOrEqual(2);
    // Instruments are drawn but kept out of the BOM.
    for (const m of nl.parts.filter((p) => p.type.startsWith('instr-'))) {
      expect(m.ref.startsWith('M')).toBe(true);
      expect(m.inBom).toBe(false);
    }
  });

  it('ESP32 + Pico examples merge all GND pins and name GPIO nets', () => {
    const esp = load('esp32-dht22');
    checkInvariants(esp.input, esp.nl);
    expect(esp.nl.nets.filter((n) => n.name === 'GND').length).toBe(1);

    const pico = load('pico-button-led');
    checkInvariants(pico.input, pico.nl);
    const board = pico.nl.parts.find((p) => p.kind === 'board')!;
    expect(board.kicadSymbol).toBe('MCU_RaspberryPi_and_Boards:Pico');
    const gndPins = board.pins.filter((p) => /^GND/.test(p.name));
    for (const p of gndPins) expect(p.net).toBe('GND');
    expect(pico.nl.nets.some((n) => /^GP\d+$/.test(n.name))).toBe(true);
  });

  it('multi-board (Pi + Uno) keeps both boards and one shared GND', () => {
    const { input, nl } = load('pi-to-arduino-led-control');
    checkInvariants(input, nl);
    const boards = nl.parts.filter((p) => p.kind === 'board');
    expect(boards.map((b) => b.ref)).toEqual(['A1', 'A2']);
    const gnd = nl.nets.find((n) => n.name === 'GND')!;
    const gndRefs = new Set(gnd.nodes.map((n) => n.ref));
    expect(gndRefs.has('A1') && gndRefs.has('A2')).toBe(true);
  });

  it('Pico board with several GND.n pins merges them into one net', () => {
    const input: SchematicInput = {
      boards: [{ id: 'raspberry-pi-pico', boardKind: 'raspberry-pi-pico' }],
      components: [
        { id: 'r1', metadataId: 'resistor', properties: { value: '220' } },
        { id: 'r2', metadataId: 'resistor', properties: { value: '1000' } },
      ],
      wires: [
        { start: { componentId: 'r1', pinName: '2' }, end: { componentId: 'raspberry-pi-pico', pinName: 'GND.1' } },
        { start: { componentId: 'r2', pinName: '2' }, end: { componentId: 'raspberry-pi-pico', pinName: 'GND.4' } },
        { start: { componentId: 'r1', pinName: '1' }, end: { componentId: 'raspberry-pi-pico', pinName: 'GP15' } },
      ],
    };
    const nl = buildSchematicNetlist(input);
    checkInvariants(input, nl);
    const gnd = nl.nets.find((n) => n.name === 'GND')!;
    expect(gnd.nodes.map((n) => `${n.ref}.${n.pin}`).sort()).toEqual(['A1.2', 'A1.3', 'R1.2', 'R2.2'].sort());
    expect(nl.parts.find((p) => p.ref === 'R1')!.value).toBe('220');
    expect(nl.parts.find((p) => p.ref === 'R2')!.value).toBe('1k');
    // r2 pin 1 is not wired: listed as unconnected.
    expect(nl.parts.find((p) => p.ref === 'R2')!.pins[0].net).toBeNull();
  });

  it('unknown component types fall back to a generic connector', () => {
    const input: SchematicInput = {
      boards: [{ id: 'arduino-uno', boardKind: 'arduino-uno' }],
      components: [{ id: 'mystery', metadataId: 'flux-capacitor-9000', properties: {} }],
      wires: [
        { start: { componentId: 'mystery', pinName: 'IN' }, end: { componentId: 'arduino-uno', pinName: '7' } },
        { start: { componentId: 'mystery', pinName: 'GND' }, end: { componentId: 'arduino-uno', pinName: 'GND.2' } },
        { start: { componentId: 'ghost', pinName: 'X' }, end: { componentId: 'arduino-uno', pinName: '8' } },
      ],
      componentNames: { resistor: 'Resistor' },
    };
    const nl = buildSchematicNetlist(input);
    checkInvariants(input, nl);
    const mystery = nl.parts.find((p) => p.sourceId === 'mystery')!;
    expect(mystery.kind).toBe('unknown');
    expect(mystery.ref).toMatch(/^J\d+$/);
    expect(mystery.kicadSymbol).toBe('Connector_Generic:Conn_01x02');
    expect(mystery.pins.map((p) => p.net)).toEqual(['D7', 'GND']);
    const ghost = nl.parts.find((p) => p.sourceId === 'ghost')!;
    expect(ghost.kind).toBe('unknown');
    expect(nl.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('a primitive wired on a pin it does not have becomes a generic part', () => {
    const input: SchematicInput = {
      boards: [],
      components: [{ id: 'r1', metadataId: 'resistor' }, { id: 'r2', metadataId: 'resistor' }],
      wires: [{ start: { componentId: 'r1', pinName: 'weird' }, end: { componentId: 'r2', pinName: '1' } }],
    };
    const nl = buildSchematicNetlist(input);
    checkInvariants(input, nl);
    expect(nl.parts[0].libId).toBe('CircuitMuse:resistor');
    expect(nl.parts[1].libId).toBe('Device:R');
  });

  it('formats component values', () => {
    expect(formatValue('10000', '', '')).toBe('10k');
    expect(formatValue(4700, '', '')).toBe('4.7k');
    expect(formatValue('10u', 'F', '')).toBe('10u');
    expect(formatValue(1e-7, 'F', '')).toBe('100nF');
    expect(formatValue(undefined, '', '1k')).toBe('1k');
  });

  it('is deterministic', () => {
    const ex = getExampleById('traffic-light')!;
    const a = buildSchematicNetlist(exampleToSchematicInput(ex));
    const b = buildSchematicNetlist(exampleToSchematicInput(ex));
    expect(a.nets).toEqual(b.nets);
    expect(a.parts.map((p) => p.ref)).toEqual(b.parts.map((p) => p.ref));
  });
});

describe('schematic netlist — every example', () => {
  it('builds, lays out and satisfies invariants for all gallery examples', () => {
    let checked = 0;
    for (const ex of exampleProjects) {
      const input = exampleToSchematicInput(ex);
      const nl = buildSchematicNetlist(input);
      checkInvariants(input, nl);
      const lay = layoutSchematic(nl);
      expect(lay.parts.length).toBe(nl.parts.length);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('agrees with the SPICE NetlistBuilder connectivity', () => {
    for (const ex of exampleProjects) {
      const input = exampleToSchematicInput(ex);
      const nl = buildSchematicNetlist(input);
      const spiceIn = buildInputFromStore({
        components: input.components.map((c) => ({ id: c.id, metadataId: c.metadataId, properties: c.properties ?? {} })),
        wires: input.wires.map((w, i) => ({ id: w.id ?? `w${i}`, start: w.start, end: w.end })) as unknown as Wire[],
        boards: input.boards.map((b) => ({ id: b.id, boardKind: b.boardKind as BoardKind, pinStates: {} })),
      });
      const { pinNetMap } = buildNetlist(spiceIn);
      const keys = [...pinNetMap.keys()];
      const buttonIds = new Set(input.components.filter((c) => /pushbutton/.test(c.metadataId)).map((c) => c.id));
      const buttonNets = new Set(
        nl.parts.filter((p) => buttonIds.has(p.sourceId)).flatMap((p) => p.pins.map((x) => x.net)),
      );
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = keys[i];
          const b = keys[j];
          const spiceSame = pinNetMap.get(a) === pinNetMap.get(b);
          const mineSame = nl.endpointNet.get(a) === nl.endpointNet.get(b);
          if (spiceSame && !mineSame) {
            // Only the deliberate split of the single SPICE vcc_rail by voltage.
            expect(pinNetMap.get(a), `${ex.id}: ${a} vs ${b}`).toBe('vcc_rail');
          }
          if (mineSame && !spiceSame) {
            const net = nl.endpointNet.get(a)!;
            const isPower = net === 'GND' || net === '+5V' || net === '+3V3';
            const viaButton = buttonNets.has(net);
            expect(isPower || viaButton, `${ex.id}: ${a} vs ${b} merged in ${net}`).toBe(true);
          }
        }
      }
    }
  });
});
