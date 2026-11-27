/**
 * Circuit → schematic netlist.
 *
 * One pure function, `buildSchematicNetlist`, turns the breadboard circuit
 * (boards + components + wires, exactly as the simulator store holds them)
 * into parts with KiCad-style references and named nets. The in-app
 * schematic view and both KiCad exports are generated from this result, so
 * they always describe the same circuit as the canvas.
 *
 * Connectivity uses the simulator's Union-Find (`simulation/spice/unionFind`)
 * and the same ground rules as `NetlistBuilder` (board GND pins from
 * `BOARD_PIN_GROUPS` + the shared `GROUND_PIN_RE`), so every GND pin on every
 * board lands in one GND net. Differences from the SPICE netlist, on purpose:
 *   - Supply pins are split by voltage (+5V, +3V3) instead of one `vcc_rail`.
 *   - A push button's paired legs (1.l/1.r, 2.l/2.r) are one schematic pin
 *     each, as on the real part.
 */
import { UnionFind } from '../simulation/spice/unionFind';
import { GROUND_PIN_RE } from '../simulation/spice/NetlistBuilder';
import { BOARD_PIN_GROUPS } from '../simulation/spice/boardPinGroups';
import { BOARD_KIND_LABELS, type BoardKind } from '../types/board';
import {
  type BoxPinSpec,
  type PinType,
  type PowerNet,
  type SymbolDef,
  batterySymbol,
  bjtSymbol,
  boxSymbol,
  capacitorSymbol,
  diodeSymbol,
  inductorSymbol,
  ledSymbol,
  mosfetSymbol,
  polarizedCapacitorSymbol,
  potentiometerSymbol,
  pushButtonSymbol,
  resistorSymbol,
  spdtSymbol,
} from './symbols';

// ── Input ─────────────────────────────────────────────────────────────────

export interface SchematicInput {
  boards: Array<{ id: string; boardKind: string; name?: string; x?: number; y?: number }>;
  components: Array<{
    id: string;
    metadataId: string;
    properties?: Record<string, unknown>;
    x?: number;
    y?: number;
  }>;
  wires: Array<{
    id?: string;
    start: { componentId: string; pinName: string };
    end: { componentId: string; pinName: string };
  }>;
  /** Optional metadataId → display name (from the component catalogue). When
   *  given, types missing from it are treated as unknown parts. */
  componentNames?: Record<string, string>;
}

// ── Output ────────────────────────────────────────────────────────────────

export interface SchPin {
  number: string;
  name: string;
  type: PinType;
  /** Net name, or null when nothing is wired to this pin. */
  net: string | null;
  /** Breadboard pin names (as used by wires) that map onto this pin. */
  circuitPins: string[];
}

export type PartKind = 'board' | 'component' | 'unknown';

export interface SchPart {
  ref: string;
  value: string;
  footprint: string;
  /** Library footprint that fits the real part, when we cannot assign it
   *  directly (board symbols use our own pin numbering). */
  footprintHint: string;
  /** Closest real KiCad library symbol (e.g. "MCU_Module:Arduino_UNO_R3"). */
  kicadSymbol: string;
  /** lib id actually written to the files; its definition is `symbol`. */
  libId: string;
  symbol: SymbolDef;
  kind: PartKind;
  /** Board id or component id on the canvas. */
  sourceId: string;
  /** Board kind or component metadataId. */
  type: string;
  description: string;
  inBom: boolean;
  pins: SchPin[];
  /** Canvas position, used to keep layout roughly familiar. */
  canvas: { x: number; y: number };
}

export interface SchNode {
  ref: string;
  pin: string;
  pinName: string;
  pinType: PinType;
}

export interface SchNet {
  code: number;
  name: string;
  power: PowerNet | null;
  nodes: SchNode[];
}

export interface SchematicNetlist {
  parts: SchPart[];
  nets: SchNet[];
  /** "componentId:pinName" (wire endpoint) → net name. */
  endpointNet: Map<string, string>;
  warnings: string[];
}

// ── Part classification ───────────────────────────────────────────────────

interface PinAlias {
  number: string;
  aliases: string[];
}

interface PrimitiveSpec {
  symbol: () => SymbolDef;
  pins: PinAlias[];
  ref: string;
  footprint: string;
  value: (props: Record<string, unknown>, metadataId: string) => string;
}

const RESISTOR_FP = 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal';
const CAP_FP = 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm';
const CP_FP = 'Capacitor_THT:CP_Radial_D5.0mm_P2.00mm';
const IND_FP = 'Inductor_THT:L_Axial_L5.3mm_D2.2mm_P10.16mm_Horizontal_Vishay_IM-1';
const LED_FP = 'LED_THT:LED_D5.0mm';
const DIODE_FP = 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal';
const BUTTON_FP = 'Button_Switch_THT:SW_PUSH_6mm';
const TO92_FP = 'Package_TO_SOT_THT:TO-92_Inline';
const TO220_FP = 'Package_TO_SOT_THT:TO-220-3_Vertical';

function prefixOf(metadataId: string, presetPrefix: RegExp): string {
  return presetPrefix.test(metadataId) ? metadataId : '';
}

/** Turn "10k", 10000, "4.7uF" into a compact KiCad value. */
export function formatValue(raw: unknown, unit: '' | 'F' | 'H', fallback: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return engineering(raw) + (unit === '' ? '' : unit);
  }
  const s = String(raw).trim();
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) {
    return engineering(Number(s)) + (unit === '' ? '' : unit);
  }
  return s.replace(/\s*(ohms?|Ω)$/i, '');
}

function engineering(v: number): string {
  if (v === 0) return '0';
  const steps: Array<[number, string]> = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  const a = Math.abs(v);
  for (const [scale, sym] of steps) {
    if (a >= scale * 0.999) {
      const n = +(v / scale).toPrecision(3);
      return `${n}${sym}`;
    }
  }
  return `${+(v / 1e-12).toPrecision(3)}p`;
}

/** Value from a preset id such as resistor-4k7 / cap-100n / ind-1m. */
function presetValue(metadataId: string): string | null {
  const m = metadataId.match(/-(\d+[kmunpKMU]?\d*)$/);
  return m ? m[1] : null;
}

function primitiveFor(metadataId: string): PrimitiveSpec | null {
  const id = metadataId.toLowerCase();
  const two = (a: string[], b: string[]): PinAlias[] => [
    { number: '1', aliases: a },
    { number: '2', aliases: b },
  ];

  if (id === 'resistor' || id === 'resistor-us' || id === 'analog-resistor' || prefixOf(id, /^resistor-\d/)) {
    return {
      symbol: resistorSymbol,
      pins: two(['1', 'A'], ['2', 'B']),
      ref: 'R',
      footprint: RESISTOR_FP,
      value: (p, m) => formatValue(p.value ?? p.resistance, '', presetValue(m) ?? '1k'),
    };
  }
  if (id === 'capacitor-electrolytic' || /^cap-elec-/.test(id)) {
    return {
      symbol: polarizedCapacitorSymbol,
      pins: two(['+', '1', 'A'], ['−', '-', '2', 'B']),
      ref: 'C',
      footprint: CP_FP,
      value: (p, m) => formatValue(p.value, 'F', (presetValue(m) ?? '1u') + 'F'),
    };
  }
  if (id === 'capacitor' || id === 'analog-capacitor' || /^cap-\d/.test(id)) {
    return {
      symbol: capacitorSymbol,
      pins: two(['1', 'A'], ['2', 'B']),
      ref: 'C',
      footprint: CAP_FP,
      value: (p, m) => formatValue(p.value, 'F', (presetValue(m) ?? '1u') + 'F'),
    };
  }
  if (id === 'inductor' || id === 'analog-inductor' || /^ind-\d/.test(id)) {
    return {
      symbol: inductorSymbol,
      pins: two(['1', 'A'], ['2', 'B']),
      ref: 'L',
      footprint: IND_FP,
      value: (p, m) => formatValue(p.value, 'H', (presetValue(m) ?? '1m') + 'H'),
    };
  }
  if (id === 'led') {
    return {
      symbol: ledSymbol,
      // Device:LED: pin 1 = K (cathode), pin 2 = A (anode)
      pins: two(['C', 'K', 'cathode'], ['A', 'anode']),
      ref: 'LED',
      footprint: LED_FP,
      value: (p) => {
        const c = String(p.color ?? 'red').trim();
        return `LED ${c.charAt(0).toUpperCase()}${c.slice(1)}`;
      },
    };
  }
  if (id === 'diode' || /^diode-/.test(id) || /^zener-/.test(id)) {
    const variant = /^zener-/.test(id) ? 'D_Zener' : /1n58\d\d/.test(id) ? 'D_Schottky' : 'D';
    return {
      symbol: () => diodeSymbol(variant),
      pins: two(['C', 'K', 'cathode'], ['A', 'anode']),
      ref: 'D',
      footprint: DIODE_FP,
      value: (_p, m) => {
        const part = m.replace(/^(diode|zener)-?/, '').toUpperCase();
        return part || 'D';
      },
    };
  }
  if (id === 'pushbutton' || id === 'pushbutton-6mm') {
    return {
      symbol: pushButtonSymbol,
      pins: two(['1.l', '1.r', '1a', '1b', '1', 'A'], ['2.l', '2.r', '2a', '2b', '2', 'B']),
      ref: 'SW',
      footprint: BUTTON_FP,
      value: (p) => (p.label ? String(p.label) : 'Push button'),
    };
  }
  if (id === 'slide-switch') {
    return {
      symbol: spdtSymbol,
      pins: [
        { number: '1', aliases: ['1'] },
        { number: '2', aliases: ['2'] },
        { number: '3', aliases: ['3'] },
      ],
      ref: 'SW',
      footprint: '',
      value: () => 'Slide switch',
    };
  }
  if (id === 'potentiometer' || id === 'slide-potentiometer') {
    return {
      symbol: potentiometerSymbol,
      pins: [
        { number: '1', aliases: ['VCC'] },
        { number: '2', aliases: ['SIG'] },
        { number: '3', aliases: ['GND'] },
      ],
      ref: 'RV',
      footprint: 'Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical',
      value: (p) => formatValue(p.total ?? p.resistance, '', '10k'),
    };
  }
  if (/^bjt-/.test(id)) {
    const pnp = /2n3906|bc557|2n2907|tip42|pnp/.test(id);
    return {
      symbol: () => bjtSymbol(pnp),
      pins: [
        { number: '1', aliases: ['B'] },
        { number: '2', aliases: ['C'] },
        { number: '3', aliases: ['E'] },
      ],
      ref: 'Q',
      footprint: /2n3055/.test(id) ? '' : TO92_FP,
      value: (_p, m) => m.replace(/^bjt-/, '').toUpperCase(),
    };
  }
  if (/^mosfet-/.test(id)) {
    const pmos = /irf9540|fqp27p06|pmos/.test(id);
    return {
      symbol: () => mosfetSymbol(pmos),
      pins: [
        { number: '1', aliases: ['G'] },
        { number: '2', aliases: ['D'] },
        { number: '3', aliases: ['S'] },
      ],
      ref: 'Q',
      footprint: /2n7000/.test(id) ? TO92_FP : TO220_FP,
      value: (_p, m) => m.replace(/^mosfet-/, '').toUpperCase(),
    };
  }
  if (/^battery-/.test(id)) {
    return {
      symbol: batterySymbol,
      pins: two(['+', 'VCC'], ['−', '-', 'GND']),
      ref: 'BT',
      footprint: '',
      value: (_p, m) => {
        const v = { 'battery-9v': '9V', 'battery-aa': '1.5V', 'battery-coin-cell': '3V' }[m];
        return v ?? 'Battery';
      },
    };
  }
  return null;
}

// ── Boards ────────────────────────────────────────────────────────────────

const BOARD_LIBRARY_SYMBOL: Record<string, { symbol: string; footprint: string }> = {
  'arduino-uno': { symbol: 'MCU_Module:Arduino_UNO_R3', footprint: 'Module:Arduino_UNO_R3' },
  'arduino-nano': { symbol: 'MCU_Module:Arduino_Nano_v3.x', footprint: 'Module:Arduino_Nano' },
  'raspberry-pi-pico': { symbol: 'MCU_RaspberryPi_and_Boards:Pico', footprint: '' },
  'pi-pico-w': { symbol: 'MCU_RaspberryPi_and_Boards:Pico', footprint: '' },
};

const BOARD_KIND_SET = new Set(Object.keys(BOARD_KIND_LABELS));

function isBoardKind(kind: string): boolean {
  return BOARD_KIND_SET.has(kind) || /^raspberry-pi/.test(kind);
}

function isArduinoFamily(kind: string): boolean {
  return kind === 'arduino-uno' || kind === 'arduino-nano' || kind === 'arduino-mega';
}

function isEsp32Family(kind: string): boolean {
  return /esp32/.test(kind);
}

/** Display name for a board pin: Arduino "13" → "D13", ESP32 "2" → "GPIO2". */
export function boardPinLabel(kind: string, pin: string): string {
  if (/^\d+$/.test(pin)) {
    if (isArduinoFamily(kind)) return `D${pin}`;
    if (isEsp32Family(kind)) return `GPIO${pin}`;
  }
  return pin;
}

const BOARD_GND_RE = /^(gnd|vss|ground)([._]?\d+)?$/i;

function boardPowerNet(kind: string, pin: string): PowerNet | null {
  const group = BOARD_PIN_GROUPS[kind as BoardKind] ?? BOARD_PIN_GROUPS.default;
  if (group.gnd.includes(pin) || BOARD_GND_RE.test(pin)) return 'GND';
  if (/^(5v|vbus|vusb)$/i.test(pin)) return '+5V';
  if (/^(3v3|3\.3v|3v3_out)$/i.test(pin)) return '+3V3';
  if (/^(vcc|vdd)$/i.test(pin)) return group.vcc >= 4.5 ? '+5V' : '+3V3';
  return null;
}

function isPowerishPin(name: string): boolean {
  return /^(gnd|vss|ground|5v|3v3|3\.3v|vin|vcc|vdd|vbus|vsys|vusb|aref|ioref|3v3_out|v\+|v-)([._]?\d+)?$/i.test(name);
}

// ── Helpers ───────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const natural = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

function safeLibName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

const POWER_ORDER: PowerNet[] = ['GND', '+5V', '+3V3'];
const POWER_KEY = (p: PowerNet) => `#PWR:${p}`;

interface Draft {
  kind: PartKind;
  sourceId: string;
  type: string;
  refPrefix: string;
  value: string;
  footprint: string;
  footprintHint?: string;
  kicadSymbol: string;
  libId: string;
  description: string;
  inBom: boolean;
  canvas: { x: number; y: number };
  /** Primitive symbol, or null for box parts (built after pin union). */
  symbol: SymbolDef | null;
  pins: Array<{ number: string; name: string; type: PinType; aliases: string[] }>;
  boxSide?: (name: string) => 'left' | 'right';
}

// ── Main ──────────────────────────────────────────────────────────────────

export function buildSchematicNetlist(input: SchematicInput): SchematicNetlist {
  const warnings: string[] = [];
  const names = input.componentNames;
  const key = (id: string, pin: string) => `${id}:${pin}`;

  // Wired pins per canvas id, in first-seen order.
  const wired = new Map<string, string[]>();
  for (const w of input.wires) {
    for (const e of [w.start, w.end]) {
      const list = wired.get(e.componentId) ?? [];
      if (!list.includes(e.pinName)) list.push(e.pinName);
      wired.set(e.componentId, list);
    }
  }

  const drafts: Draft[] = [];
  const seen = new Set<string>();

  // Boards (store boards first, then components that are really boards).
  const boardEntries: Array<{ id: string; kind: string; name?: string; x: number; y: number }> = [];
  for (const b of input.boards) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    boardEntries.push({ id: b.id, kind: b.boardKind, name: b.name, x: b.x ?? 0, y: b.y ?? 0 });
  }
  for (const c of input.components) {
    if (seen.has(c.id) || !isBoardKind(c.metadataId)) continue;
    seen.add(c.id);
    boardEntries.push({ id: c.id, kind: c.metadataId, x: c.x ?? 0, y: c.y ?? 0 });
  }
  for (const b of boardEntries) {
    const pins = [...(wired.get(b.id) ?? [])].sort((p, q) => {
      const pp = isPowerishPin(p) ? 1 : 0;
      const qp = isPowerishPin(q) ? 1 : 0;
      return pp - qp || natural(boardPinLabel(b.kind, p), boardPinLabel(b.kind, q));
    });
    const lib = BOARD_LIBRARY_SYMBOL[b.kind];
    const label = BOARD_KIND_LABELS[b.kind as BoardKind] ?? b.kind;
    drafts.push({
      kind: 'board',
      sourceId: b.id,
      type: b.kind,
      refPrefix: 'A',
      value: b.name?.trim() || label,
      footprint: '',
      footprintHint: lib?.footprint ?? '',
      kicadSymbol: lib?.symbol ?? `Connector_Generic:Conn_01x${String(Math.max(1, pins.length)).padStart(2, '0')}`,
      libId: `CircuitMuse:${safeLibName(b.kind)}`,
      description: `${label} (pins used in this circuit)`,
      inBom: true,
      canvas: { x: b.x, y: b.y },
      symbol: null,
      pins: pins.map((p) => ({
        number: '',
        name: boardPinLabel(b.kind, p),
        type: boardPowerNet(b.kind, p) ? 'passive' : 'bidirectional',
        aliases: [p],
      })),
      boxSide: (name) => (isPowerishPin(name) ? 'right' : 'left'),
    });
  }

  // Components.
  for (const c of input.components) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const props = c.properties ?? {};
    const meta = c.metadataId;
    const wiredPins = wired.get(c.id) ?? [];
    const prim = primitiveFor(meta);
    if (prim) {
      const covered = new Set(prim.pins.flatMap((p) => p.aliases));
      const unmapped = wiredPins.filter((p) => !covered.has(p));
      if (unmapped.length === 0) {
        const sym = prim.symbol();
        drafts.push({
          kind: 'component',
          sourceId: c.id,
          type: meta,
          refPrefix: prim.ref,
          value: prim.value(props, meta),
          footprint: prim.footprint,
          kicadSymbol: sym.libId,
          libId: sym.libId,
          description: sym.description,
          inBom: true,
          canvas: { x: c.x ?? 0, y: c.y ?? 0 },
          symbol: sym,
          pins: prim.pins.map((pa) => {
            const sp = sym.pins.find((s) => s.number === pa.number)!;
            return { number: pa.number, name: sp.name, type: sp.type, aliases: pa.aliases };
          }),
        });
        continue;
      }
      warnings.push(`${c.id}: pins ${unmapped.join(', ')} do not match a ${meta}; drawn as a generic part`);
    }
    // Generic box: modules, ICs, instruments, unknown types.
    const unknown = names ? !(meta in names) && !prim : false;
    const isInstrument = meta.startsWith('instr-');
    const isSource = meta === 'signal-generator' || meta === 'power-supply';
    const refPrefix = isInstrument ? 'M' : unknown || isSource ? 'J' : 'U';
    const displayName = names?.[meta];
    drafts.push({
      kind: unknown ? 'unknown' : 'component',
      sourceId: c.id,
      type: meta,
      refPrefix,
      value: displayName || meta.toUpperCase(),
      footprint: '',
      kicadSymbol: '',
      libId: `CircuitMuse:${safeLibName(meta)}`,
      description: unknown ? `Unknown part "${meta}" (generic connector)` : displayName || meta,
      inBom: !isInstrument,
      canvas: { x: c.x ?? 0, y: c.y ?? 0 },
      symbol: null,
      pins: wiredPins.map((p) => ({
        number: '',
        name: p,
        type: 'passive',
        aliases: [p],
      })),
    });
  }

  // Wire endpoints pointing at ids that exist nowhere on the canvas.
  const orphanIds = [...wired.keys()].filter((id) => !seen.has(id)).sort(natural);
  for (const id of orphanIds) {
    warnings.push(`Wire endpoint references missing part "${id}"`);
    drafts.push({
      kind: 'unknown',
      sourceId: id,
      type: 'unknown',
      refPrefix: 'J',
      value: id,
      footprint: '',
      kicadSymbol: '',
      libId: `CircuitMuse:missing_${safeLibName(id)}`,
      description: `Missing part "${id}" (generic connector)`,
      inBom: true,
      canvas: { x: 0, y: 0 },
      symbol: null,
      pins: (wired.get(id) ?? []).map((p) => ({ number: '', name: p, type: 'passive', aliases: [p] })),
    });
  }

  // Box parts of the same lib id share one symbol: union their pin names.
  const boxPins = new Map<string, string[]>();
  for (const d of drafts) {
    if (d.symbol) continue;
    const list = boxPins.get(d.libId) ?? [];
    for (const p of d.pins) if (!list.includes(p.name)) list.push(p.name);
    boxPins.set(d.libId, list);
  }
  const boxSymbols = new Map<string, SymbolDef>();
  for (const d of drafts) {
    if (d.symbol) continue;
    let sym = boxSymbols.get(d.libId);
    const pinNames = boxPins.get(d.libId)!;
    if (!sym) {
      const specs: BoxPinSpec[] = pinNames.map((name, i) => {
        const own = d.pins.find((p) => p.name === name);
        const side = d.boxSide ? d.boxSide(name) : i < Math.ceil(pinNames.length / 2) ? 'left' : 'right';
        return { number: String(i + 1), name, side, type: own?.type };
      });
      sym = boxSymbol(d.libId, d.refPrefix, d.description, specs);
      boxSymbols.set(d.libId, sym);
    }
    // Re-key this part's pins to the shared symbol (adds unwired ones).
    const aliasByName = new Map(d.pins.map((p) => [p.name, p.aliases]));
    d.pins = sym.pins.map((sp) => ({
      number: sp.number,
      name: sp.name,
      type: sp.type,
      aliases: aliasByName.get(sp.name) ?? [],
    }));
    d.symbol = sym;
    if (!d.kicadSymbol) {
      d.kicadSymbol = `Connector_Generic:Conn_01x${String(Math.max(1, sym.pins.length)).padStart(2, '0')}`;
    }
  }

  // ── References ──────────────────────────────────────────────────────────
  const counters = new Map<string, number>();
  const refs = drafts.map((d) => {
    const n = (counters.get(d.refPrefix) ?? 0) + 1;
    counters.set(d.refPrefix, n);
    return `${d.refPrefix}${n}`;
  });

  // ── Connectivity ────────────────────────────────────────────────────────
  const uf = new UnionFind();
  for (const w of input.wires) {
    uf.union(key(w.start.componentId, w.start.pinName), key(w.end.componentId, w.end.pinName));
  }
  // Pins that are one schematic pin (e.g. push-button legs) are one node.
  for (const d of drafts) {
    for (const p of d.pins) {
      const present = p.aliases.filter((a) => uf.has(key(d.sourceId, a)));
      for (let i = 1; i < present.length; i++) uf.union(key(d.sourceId, present[0]), key(d.sourceId, present[i]));
    }
  }
  // Power rails.
  for (const d of drafts) {
    for (const p of d.pins) {
      for (const a of p.aliases) {
        const k = key(d.sourceId, a);
        if (!uf.has(k)) continue;
        let pwr: PowerNet | null = null;
        if (d.kind === 'board') pwr = boardPowerNet(d.type, a);
        else if (!d.type.startsWith('instr-') && GROUND_PIN_RE.test(a)) pwr = 'GND';
        if (pwr) uf.union(k, POWER_KEY(pwr));
      }
    }
  }

  // Group pins by UF root.
  const rootOf = (k: string) => uf.find(k);
  const pinNode = (d: Draft, p: Draft['pins'][number]): string | null => {
    for (const a of p.aliases) {
      const k = key(d.sourceId, a);
      if (uf.has(k)) return rootOf(k);
    }
    return null;
  };
  interface Group {
    root: string;
    nodes: Array<{ di: number; pin: Draft['pins'][number] }>;
  }
  const groups = new Map<string, Group>();
  drafts.forEach((d, di) => {
    for (const p of d.pins) {
      const root = pinNode(d, p);
      if (!root) continue;
      let g = groups.get(root);
      if (!g) {
        g = { root, nodes: [] };
        groups.set(root, g);
      }
      g.nodes.push({ di, pin: p });
    }
  });

  // ── Net names ───────────────────────────────────────────────────────────
  const powerRoots = new Map<string, PowerNet[]>();
  for (const pwr of POWER_ORDER) {
    const k = POWER_KEY(pwr);
    if (!uf.has(k)) continue;
    const r = rootOf(k);
    const list = powerRoots.get(r) ?? [];
    list.push(pwr);
    powerRoots.set(r, list);
  }
  for (const list of powerRoots.values()) {
    if (list.length > 1) warnings.push(`Supply short: ${list.join(' and ')} are wired together`);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => {
    const ka = minNodeKey(a, refs);
    const kb = minNodeKey(b, refs);
    return natural(ka, kb);
  });
  const used = new Set<string>(POWER_ORDER);
  const netName = new Map<string, { name: string; power: PowerNet | null }>();
  // Power nets.
  for (const g of sortedGroups) {
    const pw = powerRoots.get(g.root);
    if (pw) netName.set(g.root, { name: pw[0], power: pw[0] });
  }
  // Board-pin named nets.
  for (const g of sortedGroups) {
    if (netName.has(g.root)) continue;
    const boardNodes = g.nodes
      .filter((n) => drafts[n.di].kind === 'board')
      .sort((a, b) => a.di - b.di || natural(a.pin.name, b.pin.name));
    if (boardNodes.length === 0) continue;
    const first = boardNodes[0];
    let name = first.pin.name;
    if (used.has(name)) name = `${refs[first.di]}_${first.pin.name}`;
    let n = 2;
    while (used.has(name)) name = `${refs[first.di]}_${first.pin.name}_${n++}`;
    used.add(name);
    netName.set(g.root, { name, power: null });
  }
  // Everything else: KiCad-style "Net-(R1-Pad2)".
  for (const g of sortedGroups) {
    if (netName.has(g.root)) continue;
    const first = [...g.nodes].sort((a, b) => natural(refs[a.di], refs[b.di]) || natural(a.pin.number, b.pin.number))[0];
    let name = `Net-(${refs[first.di]}-Pad${first.pin.number})`;
    let n = 2;
    while (used.has(name)) name = `Net-(${refs[first.di]}-Pad${first.pin.number})_${n++}`;
    used.add(name);
    netName.set(g.root, { name, power: null });
  }

  // ── Assemble ────────────────────────────────────────────────────────────
  const parts: SchPart[] = drafts.map((d, di) => ({
    ref: refs[di],
    value: d.value,
    footprint: d.footprint,
    footprintHint: d.footprintHint ?? '',
    kicadSymbol: d.kicadSymbol,
    libId: d.libId,
    symbol: d.symbol!,
    kind: d.kind,
    sourceId: d.sourceId,
    type: d.type,
    description: d.description,
    inBom: d.inBom,
    canvas: d.canvas,
    pins: d.pins.map((p) => {
      const root = pinNode(d, p);
      return {
        number: p.number,
        name: p.name,
        type: p.type,
        net: root ? netName.get(root)!.name : null,
        circuitPins: p.aliases.filter((a) => uf.has(key(d.sourceId, a))),
      };
    }),
  }));

  const netList = sortedGroups.map((g) => {
    const info = netName.get(g.root)!;
    return {
      name: info.name,
      power: info.power,
      nodes: g.nodes
        .map((n) => ({ ref: refs[n.di], pin: n.pin.number, pinName: n.pin.name, pinType: n.pin.type }))
        .sort((a, b) => natural(a.ref, b.ref) || natural(a.pin, b.pin)),
    };
  });
  netList.sort((a, b) => {
    const pa = a.power ? POWER_ORDER.indexOf(a.power) : 99;
    const pb = b.power ? POWER_ORDER.indexOf(b.power) : 99;
    return pa - pb || natural(a.name, b.name);
  });
  const nets: SchNet[] = netList.map((n, i) => ({ code: i + 1, ...n }));

  const endpointNet = new Map<string, string>();
  for (const w of input.wires) {
    for (const e of [w.start, w.end]) {
      const k = key(e.componentId, e.pinName);
      const info = netName.get(rootOf(k));
      if (info) endpointNet.set(k, info.name);
    }
  }

  return { parts, nets, endpointNet, warnings };
}

function minNodeKey(g: { nodes: Array<{ di: number; pin: { number: string } }> }, refs: string[]): string {
  let best = '';
  for (const n of g.nodes) {
    const k = `${refs[n.di]}.${n.pin.number}`;
    if (!best || natural(k, best) < 0) best = k;
  }
  return best;
}
