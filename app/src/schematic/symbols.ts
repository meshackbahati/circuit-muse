/**
 * Schematic symbol geometry, shared by the in-app SVG view and the KiCad
 * `.kicad_sch` writer so both always draw the same thing.
 *
 * Coordinates are KiCad symbol coordinates: millimetres, Y axis pointing UP,
 * origin at the symbol anchor. A pin's (x, y) is its connection point (the
 * free end); `angle` is the direction from that point towards the body
 * (0 = right, 90 = up, 180 = left, 270 = down), exactly like KiCad.
 *
 * The primitive symbols (resistor, LED, ...) follow the shape and pin
 * numbering of the matching KiCad 8 standard-library symbols, so a part
 * placed as "Device:R" here keeps its pin numbers if the user later runs
 * "Update symbols from library" in KiCad.
 */

export type PinType =
  | 'passive'
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'power_in'
  | 'power_out'
  | 'unspecified';

export type PinAngle = 0 | 90 | 180 | 270;

export interface SymPin {
  number: string;
  name: string;
  x: number;
  y: number;
  angle: PinAngle;
  length: number;
  type: PinType;
}

export type Fill = 'none' | 'outline' | 'background';

export type SymShape =
  | { kind: 'rect'; x1: number; y1: number; x2: number; y2: number; fill?: Fill; width?: number }
  | { kind: 'poly'; pts: Array<[number, number]>; fill?: Fill; width?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: Fill; width?: number };

export interface FieldPos {
  x: number;
  y: number;
  /** Text rotation in degrees (0 or 90). */
  angle: 0 | 90;
  justify?: 'left' | 'right';
  hide?: boolean;
}

export interface SymbolDef {
  /** Full KiCad lib id, e.g. "Device:R" or "CircuitMuse:arduino_uno". */
  libId: string;
  refPrefix: string;
  description: string;
  shapes: SymShape[];
  pins: SymPin[];
  showPinNames: boolean;
  showPinNumbers: boolean;
  /** KiCad `pin_names (offset N)`: 0 = names drawn along the pin. */
  pinNameOffset: number;
  power?: boolean;
  refField: FieldPos;
  valueField: FieldPos;
  /** Bounding box of body + pins in symbol coordinates (y up). */
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

/** Schematic grid. Pin ends are kept on multiples of this. */
export const GRID = 1.27;

function computeBBox(shapes: SymShape[], pins: SymPin[]): SymbolDef['bbox'] {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  };
  for (const s of shapes) {
    if (s.kind === 'rect') {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    } else if (s.kind === 'poly') {
      for (const [x, y] of s.pts) add(x, y);
    } else {
      add(s.cx - s.r, s.cy - s.r);
      add(s.cx + s.r, s.cy + s.r);
    }
  }
  for (const p of pins) add(p.x, p.y);
  if (!Number.isFinite(x1)) return { x1: -2.54, y1: -2.54, x2: 2.54, y2: 2.54 };
  return { x1, y1, x2, y2 };
}

function def(d: Omit<SymbolDef, 'bbox'>): SymbolDef {
  return { ...d, bbox: computeBBox(d.shapes, d.pins) };
}

/** Body end of a pin (where it meets the symbol outline). */
export function pinInnerEnd(p: SymPin): [number, number] {
  switch (p.angle) {
    case 0:
      return [p.x + p.length, p.y];
    case 180:
      return [p.x - p.length, p.y];
    case 90:
      return [p.x, p.y + p.length];
    default:
      return [p.x, p.y - p.length];
  }
}

/** Direction pointing AWAY from the body at the pin's free end (angle). */
export function pinOutwardAngle(p: SymPin): PinAngle {
  return ((p.angle + 180) % 360) as PinAngle;
}

// ── Vertical two-pin parts (pins 1 top, 2 bottom) ────────────────────────

const VERT_REF: FieldPos = { x: 2.54, y: 1.27, angle: 0, justify: 'left' };
const VERT_VAL: FieldPos = { x: 2.54, y: -1.27, angle: 0, justify: 'left' };

function vertPins(len: number, names: [string, string] = ['~', '~'], half = 3.81): SymPin[] {
  return [
    { number: '1', name: names[0], x: 0, y: half, angle: 270, length: len, type: 'passive' },
    { number: '2', name: names[1], x: 0, y: -half, angle: 90, length: len, type: 'passive' },
  ];
}

export function resistorSymbol(): SymbolDef {
  return def({
    libId: 'Device:R',
    refPrefix: 'R',
    description: 'Resistor',
    shapes: [{ kind: 'rect', x1: -1.016, y1: -2.54, x2: 1.016, y2: 2.54, width: 0.254 }],
    pins: vertPins(1.27),
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    refField: VERT_REF,
    valueField: VERT_VAL,
  });
}

export function capacitorSymbol(): SymbolDef {
  return def({
    libId: 'Device:C',
    refPrefix: 'C',
    description: 'Unpolarized capacitor',
    shapes: [
      { kind: 'poly', pts: [[-2.032, -0.762], [2.032, -0.762]], width: 0.508 },
      { kind: 'poly', pts: [[-2.032, 0.762], [2.032, 0.762]], width: 0.508 },
    ],
    pins: vertPins(2.794),
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0.254,
    refField: { x: 3.048, y: 1.27, angle: 0, justify: 'left' },
    valueField: { x: 3.048, y: -1.27, angle: 0, justify: 'left' },
  });
}

export function polarizedCapacitorSymbol(): SymbolDef {
  return def({
    libId: 'Device:C_Polarized',
    refPrefix: 'C',
    description: 'Polarized capacitor',
    shapes: [
      { kind: 'rect', x1: -2.286, y1: 0.508, x2: 2.286, y2: 1.016, width: 0.254 },
      { kind: 'rect', x1: -2.286, y1: -1.016, x2: 2.286, y2: -0.508, width: 0.254, fill: 'outline' },
      { kind: 'poly', pts: [[-1.778, 2.286], [-0.762, 2.286]], width: 0.2 },
      { kind: 'poly', pts: [[-1.27, 2.794], [-1.27, 1.778]], width: 0.2 },
    ],
    pins: [
      { number: '1', name: '+', x: 0, y: 3.81, angle: 270, length: 2.794, type: 'passive' },
      { number: '2', name: '-', x: 0, y: -3.81, angle: 90, length: 2.794, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0.254,
    refField: { x: 3.048, y: 1.27, angle: 0, justify: 'left' },
    valueField: { x: 3.048, y: -1.27, angle: 0, justify: 'left' },
  });
}

export function inductorSymbol(): SymbolDef {
  // Four half-circle bumps drawn as a polyline (no arcs needed).
  const pts: Array<[number, number]> = [];
  const r = 0.635;
  for (let i = 0; i < 4; i++) {
    const cy = 1.905 - i * 1.27;
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI / 2 - (Math.PI * k) / 6;
      pts.push([+(r * Math.cos(a)).toFixed(4), +(cy + r * Math.sin(a)).toFixed(4)]);
    }
  }
  return def({
    libId: 'Device:L',
    refPrefix: 'L',
    description: 'Inductor',
    shapes: [{ kind: 'poly', pts, width: 0.254 }],
    pins: vertPins(1.27),
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 1.016,
    refField: VERT_REF,
    valueField: VERT_VAL,
  });
}

export function batterySymbol(): SymbolDef {
  return def({
    libId: 'Device:Battery',
    refPrefix: 'BT',
    description: 'Multiple-cell battery',
    shapes: [
      { kind: 'rect', x1: -2.286, y1: 1.778, x2: 2.286, y2: 1.524, fill: 'outline', width: 0 },
      { kind: 'rect', x1: -1.524, y1: 1.016, x2: 1.524, y2: 0.508, fill: 'outline', width: 0 },
      { kind: 'rect', x1: -2.286, y1: -0.508, x2: 2.286, y2: -0.762, fill: 'outline', width: 0 },
      { kind: 'rect', x1: -1.524, y1: -1.27, x2: 1.524, y2: -1.778, fill: 'outline', width: 0 },
      { kind: 'poly', pts: [[0, 1.778], [0, 2.54]], width: 0 },
      { kind: 'poly', pts: [[0, -1.778], [0, -2.54]], width: 0 },
      { kind: 'poly', pts: [[0.762, 3.048], [1.778, 3.048]], width: 0.254 },
      { kind: 'poly', pts: [[1.27, 3.556], [1.27, 2.54]], width: 0.254 },
    ],
    pins: [
      { number: '1', name: '+', x: 0, y: 5.08, angle: 270, length: 2.54, type: 'passive' },
      { number: '2', name: '-', x: 0, y: -5.08, angle: 90, length: 2.54, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0.762,
    refField: { x: 3.048, y: 1.27, angle: 0, justify: 'left' },
    valueField: { x: 3.048, y: -1.27, angle: 0, justify: 'left' },
  });
}

export function potentiometerSymbol(): SymbolDef {
  return def({
    libId: 'Device:R_Potentiometer',
    refPrefix: 'RV',
    description: 'Potentiometer',
    shapes: [
      { kind: 'rect', x1: -1.016, y1: -2.54, x2: 1.016, y2: 2.54, width: 0.254 },
      { kind: 'poly', pts: [[2.54, 0], [1.524, 0]], width: 0 },
      { kind: 'poly', pts: [[1.143, 0], [2.286, 0.508], [2.286, -0.508], [1.143, 0]], fill: 'outline', width: 0 },
    ],
    pins: [
      { number: '1', name: '1', x: 0, y: 3.81, angle: 270, length: 1.27, type: 'passive' },
      { number: '2', name: '2', x: 3.81, y: 0, angle: 180, length: 1.27, type: 'passive' },
      { number: '3', name: '3', x: 0, y: -3.81, angle: 90, length: 1.27, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 1.016,
    refField: { x: -4.445, y: 1.27, angle: 0, justify: 'right' },
    valueField: { x: -4.445, y: -1.27, angle: 0, justify: 'right' },
  });
}

// ── Horizontal parts ──────────────────────────────────────────────────────

function diodeBody(extra: SymShape[], bar: Array<[number, number]>): SymShape[] {
  return [
    { kind: 'poly', pts: [[1.27, 0], [-1.27, 0]], width: 0 },
    { kind: 'poly', pts: bar, width: 0.254 },
    { kind: 'poly', pts: [[1.27, 1.27], [1.27, -1.27], [-1.27, 0], [1.27, 1.27]], width: 0.254 },
    ...extra,
  ];
}

const DIODE_PINS: SymPin[] = [
  { number: '1', name: 'K', x: -3.81, y: 0, angle: 0, length: 2.54, type: 'passive' },
  { number: '2', name: 'A', x: 3.81, y: 0, angle: 180, length: 2.54, type: 'passive' },
];

export function diodeSymbol(variant: 'D' | 'D_Zener' | 'D_Schottky' = 'D'): SymbolDef {
  let bar: Array<[number, number]> = [[-1.27, 1.27], [-1.27, -1.27]];
  if (variant === 'D_Zener') bar = [[-0.762, 1.27], [-1.27, 1.27], [-1.27, -1.27], [-1.778, -1.27]];
  if (variant === 'D_Schottky')
    bar = [[-0.635, 1.016], [-0.635, 1.27], [-1.27, 1.27], [-1.27, -1.27], [-1.905, -1.27], [-1.905, -1.016]];
  return def({
    libId: `Device:${variant}`,
    refPrefix: 'D',
    description: variant === 'D' ? 'Diode' : variant === 'D_Zener' ? 'Zener diode' : 'Schottky diode',
    shapes: diodeBody([], bar),
    pins: DIODE_PINS,
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 1.016,
    refField: { x: 0, y: 2.54, angle: 0 },
    valueField: { x: 0, y: -2.54, angle: 0 },
  });
}

export function ledSymbol(): SymbolDef {
  const arrows: SymShape[] = [
    { kind: 'poly', pts: [[-3.048, -0.762], [-4.572, -2.286], [-3.81, -2.286], [-4.572, -2.286], [-4.572, -1.524]], width: 0 },
    { kind: 'poly', pts: [[-1.778, -0.762], [-3.302, -2.286], [-2.54, -2.286], [-3.302, -2.286], [-3.302, -1.524]], width: 0 },
  ];
  return def({
    libId: 'Device:LED',
    refPrefix: 'D',
    description: 'Light emitting diode',
    shapes: diodeBody(arrows, [[-1.27, -1.27], [-1.27, 1.27]]),
    pins: DIODE_PINS,
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 1.016,
    refField: { x: 0, y: 2.54, angle: 0 },
    valueField: { x: 0, y: -3.81, angle: 0 },
  });
}

export function pushButtonSymbol(): SymbolDef {
  return def({
    libId: 'Switch:SW_Push',
    refPrefix: 'SW',
    description: 'Push button switch, normally open',
    shapes: [
      { kind: 'circle', cx: -2.032, cy: 0, r: 0.508, width: 0 },
      { kind: 'circle', cx: 2.032, cy: 0, r: 0.508, width: 0 },
      { kind: 'poly', pts: [[0, 1.27], [0, 3.048]], width: 0 },
      { kind: 'poly', pts: [[2.54, 1.27], [-2.54, 1.27]], width: 0 },
    ],
    pins: [
      { number: '1', name: '1', x: -5.08, y: 0, angle: 0, length: 2.54, type: 'passive' },
      { number: '2', name: '2', x: 5.08, y: 0, angle: 180, length: 2.54, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 1.016,
    refField: { x: 0, y: 5.08, angle: 0 },
    valueField: { x: 0, y: -2.54, angle: 0 },
  });
}

export function spdtSymbol(): SymbolDef {
  return def({
    libId: 'Switch:SW_SPDT',
    refPrefix: 'SW',
    description: 'Switch, single pole double throw',
    shapes: [
      { kind: 'circle', cx: -2.032, cy: 0, r: 0.508, width: 0 },
      { kind: 'circle', cx: 2.032, cy: 2.54, r: 0.508, width: 0 },
      { kind: 'circle', cx: 2.032, cy: -2.54, r: 0.508, width: 0 },
      { kind: 'poly', pts: [[-1.524, 0.254], [1.524, 2.286]], width: 0 },
    ],
    pins: [
      { number: '1', name: 'A', x: 5.08, y: 2.54, angle: 180, length: 2.54, type: 'passive' },
      { number: '2', name: 'B', x: -5.08, y: 0, angle: 0, length: 2.54, type: 'passive' },
      { number: '3', name: 'C', x: 5.08, y: -2.54, angle: 180, length: 2.54, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    refField: { x: 0, y: 5.08, angle: 0 },
    valueField: { x: 0, y: -5.08, angle: 0 },
  });
}

export function bjtSymbol(pnp: boolean): SymbolDef {
  const arrow: SymShape = pnp
    ? { kind: 'poly', pts: [[1.524, -2.286], [1.016, -1.27], [2.032, -1.778], [1.524, -2.286]], fill: 'outline', width: 0 }
    : { kind: 'poly', pts: [[1.651, -1.651], [2.159, -2.159], [1.651, -2.159], [1.651, -1.651]], fill: 'outline', width: 0 };
  return def({
    libId: pnp ? 'Device:Q_PNP_BCE' : 'Device:Q_NPN_BCE',
    refPrefix: 'Q',
    description: pnp ? 'PNP transistor, base/collector/emitter' : 'NPN transistor, base/collector/emitter',
    shapes: [
      { kind: 'circle', cx: 1.27, cy: 0, r: 2.8194, width: 0.254 },
      { kind: 'poly', pts: [[0.635, 1.905], [0.635, -1.905]], width: 0.508 },
      { kind: 'poly', pts: [[0.635, 0.635], [2.54, 2.54]], width: 0 },
      { kind: 'poly', pts: [[0.635, -0.635], [2.54, -2.54]], width: 0 },
      arrow,
    ],
    pins: [
      { number: '1', name: 'B', x: -5.08, y: 0, angle: 0, length: 5.715, type: 'input' },
      { number: '2', name: 'C', x: 2.54, y: 5.08, angle: 270, length: 2.54, type: 'passive' },
      { number: '3', name: 'E', x: 2.54, y: -5.08, angle: 90, length: 2.54, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    refField: { x: 5.08, y: 1.27, angle: 0, justify: 'left' },
    valueField: { x: 5.08, y: -1.27, angle: 0, justify: 'left' },
  });
}

export function mosfetSymbol(pmos: boolean): SymbolDef {
  const arrow: SymShape = pmos
    ? { kind: 'poly', pts: [[2.286, 0], [1.27, 0.381], [1.27, -0.381], [2.286, 0]], fill: 'outline', width: 0 }
    : { kind: 'poly', pts: [[0.762, 0], [1.778, 0.381], [1.778, -0.381], [0.762, 0]], fill: 'outline', width: 0 };
  return def({
    libId: pmos ? 'Device:Q_PMOS_GDS' : 'Device:Q_NMOS_GDS',
    refPrefix: 'Q',
    description: pmos ? 'P-MOSFET transistor, gate/drain/source' : 'N-MOSFET transistor, gate/drain/source',
    shapes: [
      { kind: 'circle', cx: 1.651, cy: 0, r: 2.794, width: 0.254 },
      { kind: 'poly', pts: [[0.254, 1.905], [0.254, -1.905]], width: 0.254 },
      { kind: 'poly', pts: [[0.762, 2.286], [0.762, 1.27]], width: 0.254 },
      { kind: 'poly', pts: [[0.762, 0.508], [0.762, -0.508]], width: 0.254 },
      { kind: 'poly', pts: [[0.762, -1.27], [0.762, -2.286]], width: 0.254 },
      { kind: 'poly', pts: [[0.762, 1.778], [2.54, 1.778], [2.54, 2.54]], width: 0 },
      { kind: 'poly', pts: [[0.762, -1.778], [2.54, -1.778], [2.54, -2.54]], width: 0 },
      { kind: 'poly', pts: [[0.762, 0], [2.54, 0], [2.54, -1.778]], width: 0 },
      arrow,
    ],
    pins: [
      { number: '1', name: 'G', x: -5.08, y: 0, angle: 0, length: 5.334, type: 'input' },
      { number: '2', name: 'D', x: 2.54, y: 5.08, angle: 270, length: 2.54, type: 'passive' },
      { number: '3', name: 'S', x: 2.54, y: -5.08, angle: 90, length: 2.54, type: 'passive' },
    ],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    refField: { x: 5.08, y: 1.27, angle: 0, justify: 'left' },
    valueField: { x: 5.08, y: -1.27, angle: 0, justify: 'left' },
  });
}

// ── Generic box (boards, modules, unknown parts) ──────────────────────────

export interface BoxPinSpec {
  number: string;
  name: string;
  side: 'left' | 'right';
  type?: PinType;
}

/** Approximate rendered width of KiCad's 1.27 mm default font, per char. */
export const CHAR_W = 1.05;

export function boxSymbol(libId: string, refPrefix: string, description: string, pins: BoxPinSpec[]): SymbolDef {
  const left = pins.filter((p) => p.side === 'left');
  const right = pins.filter((p) => p.side === 'right');
  const rows = Math.max(left.length, right.length, 1);
  const pitch = 2.54;
  const maxLeft = Math.max(0, ...left.map((p) => p.name.length));
  const maxRight = Math.max(0, ...right.map((p) => p.name.length));
  // Body wide enough for both columns of pin names plus a gap; multiple of 2*2.54.
  const rawW = Math.max(10.16, (maxLeft + maxRight) * CHAR_W + 5.08);
  const halfW = Math.ceil(rawW / 2 / 2.54) * 2.54;
  // Pin rows on the 2.54 grid, centred around y=0.
  const top = +(Math.ceil((rows - 1) / 2) * pitch).toFixed(4);
  const bodyTop = top + 2.54;
  const bodyBottom = top - rows * pitch;
  const pinLen = 2.54;
  const symPins: SymPin[] = [];
  left.forEach((p, i) => {
    symPins.push({
      number: p.number,
      name: p.name,
      x: -halfW - pinLen,
      y: +(top - i * pitch).toFixed(4),
      angle: 0,
      length: pinLen,
      type: p.type ?? 'passive',
    });
  });
  right.forEach((p, i) => {
    symPins.push({
      number: p.number,
      name: p.name,
      x: halfW + pinLen,
      y: +(top - i * pitch).toFixed(4),
      angle: 180,
      length: pinLen,
      type: p.type ?? 'passive',
    });
  });
  return def({
    libId,
    refPrefix,
    description,
    shapes: [{ kind: 'rect', x1: -halfW, y1: bodyBottom, x2: halfW, y2: bodyTop, width: 0.254, fill: 'background' }],
    pins: symPins,
    showPinNames: true,
    showPinNumbers: true,
    pinNameOffset: 1.016,
    refField: { x: -halfW, y: bodyTop + 1.27, angle: 0, justify: 'left' },
    valueField: { x: -halfW, y: bodyBottom - 1.27, angle: 0, justify: 'left' },
  });
}

// ── Power symbols ────────────────────────────────────────────────────────

export type PowerNet = 'GND' | '+5V' | '+3V3';

export function powerSymbol(net: PowerNet): SymbolDef {
  if (net === 'GND') {
    return def({
      libId: 'power:GND',
      refPrefix: '#PWR',
      description: 'Power symbol creates a global label with name "GND" , ground',
      shapes: [
        { kind: 'poly', pts: [[0, 0], [0, -1.27], [1.27, -1.27], [0, -2.54], [-1.27, -1.27], [0, -1.27]], width: 0 },
      ],
      pins: [{ number: '1', name: 'GND', x: 0, y: 0, angle: 270, length: 0, type: 'power_in' }],
      showPinNames: false,
      showPinNumbers: false,
      pinNameOffset: 0,
      power: true,
      refField: { x: 0, y: -6.35, angle: 0, hide: true },
      valueField: { x: 0, y: -3.81, angle: 0 },
    });
  }
  return def({
    libId: `power:${net}`,
    refPrefix: '#PWR',
    description: `Power symbol creates a global label with name "${net}"`,
    shapes: [
      { kind: 'poly', pts: [[-0.762, 1.27], [0, 2.54]], width: 0 },
      { kind: 'poly', pts: [[0, 0], [0, 2.54]], width: 0 },
      { kind: 'poly', pts: [[0, 2.54], [0.762, 1.27]], width: 0 },
    ],
    pins: [{ number: '1', name: net, x: 0, y: 0, angle: 90, length: 0, type: 'power_in' }],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    power: true,
    refField: { x: 0, y: -3.81, angle: 0, hide: true },
    valueField: { x: 0, y: 3.556, angle: 0 },
  });
}

/** Direction (screen angle, y up) the power symbol's graphic points to at rotation 0. */
export function powerBaseAngle(net: PowerNet): PinAngle {
  return net === 'GND' ? 270 : 90;
}

/** KiCad's power:PWR_FLAG. Marks a power net as driven so ERC does not
 *  report "power pin not driven" for GND and the supply rails. */
export function pwrFlagSymbol(): SymbolDef {
  return def({
    libId: 'power:PWR_FLAG',
    refPrefix: '#FLG',
    description: 'Special symbol for telling ERC where power comes from',
    shapes: [
      { kind: 'poly', pts: [[0, 0], [0, 1.27], [-1.016, 1.905], [0, 2.54], [1.016, 1.905], [0, 1.27]], width: 0 },
    ],
    pins: [{ number: '1', name: 'pwr', x: 0, y: 0, angle: 90, length: 0, type: 'power_out' }],
    showPinNames: false,
    showPinNumbers: false,
    pinNameOffset: 0,
    power: true,
    refField: { x: 0, y: 1.905, angle: 0, hide: true },
    valueField: { x: 0, y: 3.81, angle: 0 },
  });
}
