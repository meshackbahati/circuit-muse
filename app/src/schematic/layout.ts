/**
 * Automatic schematic layout.
 *
 * Readability over routing: every connected pin gets a short stub ending in
 * a net label (or a power symbol for GND / +5V / +3V3), so there are no
 * crossing wires to untangle. Boards are stacked in a column on the left;
 * the other parts flow in rows to the right, ordered so parts that talk to
 * the same board (and the same board pins) sit next to each other.
 *
 * All coordinates are schematic millimetres with Y pointing DOWN (KiCad
 * sheet coordinates). Symbol origins are snapped to the 2.54 mm grid so
 * every pin end lands on the 1.27 mm connection grid.
 */
import type { SchematicNetlist, SchPart } from './netlist';
import {
  CHAR_W,
  type PinAngle,
  type PowerNet,
  type SymPin,
  pinOutwardAngle,
  powerBaseAngle,
} from './symbols';

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedPart {
  part: SchPart;
  /** Symbol origin on the sheet. */
  x: number;
  y: number;
  bounds: Rect;
}

export interface PlacedStub {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedLabel {
  net: string;
  x: number;
  y: number;
  /** Text direction (KiCad label angle): 0 right, 90 up, 180 left, 270 down. */
  angle: PinAngle;
  justify: 'left' | 'right';
}

export interface PlacedPower {
  net: PowerNet;
  x: number;
  y: number;
  rotation: PinAngle;
}

export interface PlacedNoConnect {
  x: number;
  y: number;
}

export interface SchematicLayout {
  parts: PlacedPart[];
  stubs: PlacedStub[];
  labels: PlacedLabel[];
  powers: PlacedPower[];
  noConnects: PlacedNoConnect[];
  /** Extent of everything placed (sheet mm). */
  bounds: Rect;
  paper: { name: string; width: number; height: number };
}

export const STUB = 2.54;
const PITCH = 2.54;
const MARGIN = 25.4;
const GAP = 7.62;

/** Unit vector in sheet coordinates (y down) for a y-up angle. */
export function dirOf(angle: PinAngle): [number, number] {
  switch (angle) {
    case 0:
      return [1, 0];
    case 90:
      return [0, -1];
    case 180:
      return [-1, 0];
    default:
      return [0, 1];
  }
}

/** Sheet position of a pin's connection point for a symbol at (x, y). */
export function pinEnd(x: number, y: number, p: SymPin): [number, number] {
  return [round(x + p.x), round(y - p.y)];
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

const snapUp = (v: number) => Math.ceil(v / PITCH - 1e-9) * PITCH;

export function labelLength(text: string): number {
  return text.length * CHAR_W + 2.54;
}

/** Bounds of a part (symbol, labels, fields) relative to its origin. */
function localBounds(part: SchPart): Rect {
  const s = part.symbol;
  const r: Rect = { x1: s.bbox.x1, y1: -s.bbox.y2, x2: s.bbox.x2, y2: -s.bbox.y1 };
  const grow = (x: number, y: number) => {
    if (x < r.x1) r.x1 = x;
    if (x > r.x2) r.x2 = x;
    if (y < r.y1) r.y1 = y;
    if (y > r.y2) r.y2 = y;
  };
  s.pins.forEach((p) => {
    const net = netOfPin(part, p.number);
    if (!net) return;
    const [dx, dy] = dirOf(pinOutwardAngle(p));
    const ext = STUB + (isPower(net) ? 5.08 : labelLength(net));
    const ex = p.x + dx * ext;
    const ey = -p.y + dy * ext;
    grow(ex, ey);
    // Label text height / power symbol width across the stub direction.
    if (dx !== 0) {
      grow(ex, ey - 1.6);
      grow(ex, ey + 1.6);
    } else {
      const half = isPower(net) ? net.length * CHAR_W * 0.5 + 0.6 : 1.6;
      grow(ex - half, ey);
      grow(ex + half, ey);
    }
  });
  for (const [f, text] of [
    [s.refField, part.ref],
    [s.valueField, part.value],
  ] as const) {
    if (f.hide) continue;
    const w = text.length * CHAR_W;
    const fx = f.x;
    const fy = -f.y;
    const x1 = f.justify === 'left' ? fx : f.justify === 'right' ? fx - w : fx - w / 2;
    grow(x1, fy - 1.3);
    grow(x1 + w, fy + 1.3);
  }
  return r;
}

/** Net on the part pin with this number (null when unconnected). */
export function netOfPin(part: SchPart, number: string): string | null {
  return part.pins.find((p) => p.number === number)?.net ?? null;
}

export function isPower(net: string): net is PowerNet {
  return net === 'GND' || net === '+5V' || net === '+3V3';
}

const PAPERS: Array<{ name: string; width: number; height: number }> = [
  { name: 'A4', width: 297, height: 210 },
  { name: 'A3', width: 420, height: 297 },
  { name: 'A2', width: 594, height: 420 },
  { name: 'A1', width: 841, height: 594 },
  { name: 'A0', width: 1189, height: 841 },
];

export function layoutSchematic(netlist: SchematicNetlist): SchematicLayout {
  const parts = netlist.parts;
  const boards = parts.filter((p) => p.kind === 'board');
  const others = parts.filter((p) => p.kind !== 'board');

  // Which board pins each net touches (board index, pin row) for grouping.
  const netAnchor = new Map<string, number>();
  boards.forEach((b, bi) => {
    b.pins.forEach((p, pi) => {
      if (!p.net || isPower(p.net)) return;
      if (!netAnchor.has(p.net)) netAnchor.set(p.net, bi * 1000 + pi);
    });
  });
  const anchorOf = (p: SchPart): number => {
    let best = Infinity;
    for (const pin of p.pins) {
      if (!pin.net) continue;
      const a = netAnchor.get(pin.net);
      if (a !== undefined && a < best) best = a;
    }
    return best;
  };
  // Seeds sorted by the board pin they hang off; then walk signal nets
  // depth-first so a chain (pin → resistor → LED) stays together.
  const seeds = others
    .map((p, i) => ({ p, i, a: anchorOf(p) }))
    .sort((u, v) => u.a - v.a || u.i - v.i)
    .map((o) => o.p);
  const byNet = new Map<string, SchPart[]>();
  for (const p of others) {
    for (const pin of p.pins) {
      if (!pin.net || isPower(pin.net)) continue;
      const list = byNet.get(pin.net) ?? [];
      if (!list.includes(p)) list.push(p);
      byNet.set(pin.net, list);
    }
  }
  const order: SchPart[] = [];
  const visited = new Set<SchPart>();
  const visit = (p: SchPart) => {
    if (visited.has(p)) return;
    visited.add(p);
    order.push(p);
    for (const pin of p.pins) {
      if (!pin.net || isPower(pin.net)) continue;
      for (const q of byNet.get(pin.net) ?? []) visit(q);
    }
  };
  for (const p of seeds) visit(p);

  const placed: PlacedPart[] = [];
  let cursorY = MARGIN;
  let boardsRight = MARGIN;

  // Boards: one column.
  for (const b of boards) {
    const lb = localBounds(b);
    const x = snapUp(MARGIN - lb.x1);
    const y = snapUp(cursorY - lb.y1);
    placed.push({ part: b, x, y, bounds: offset(lb, x, y) });
    cursorY = y + lb.y2 + GAP;
    boardsRight = Math.max(boardsRight, x + lb.x2);
  }

  // Other parts: shelf packing in rows to the right of the boards.
  const startX = boards.length ? boardsRight + GAP * 2 : MARGIN;
  const sized = order.map((p) => ({ p, lb: localBounds(p) }));
  const area = sized.reduce((s, o) => s + (o.lb.x2 - o.lb.x1 + GAP) * (o.lb.y2 - o.lb.y1 + GAP), 0);
  const rowLimit = Math.max(160, Math.sqrt(area * 1.6));
  let x = startX;
  let rowTop = MARGIN;
  let rowH = 0;
  for (const { p, lb } of sized) {
    const w = lb.x2 - lb.x1;
    if (x > startX && x + w > startX + rowLimit) {
      x = startX;
      rowTop += rowH + GAP;
      rowH = 0;
    }
    const ox = snapUp(x - lb.x1);
    const oy = snapUp(rowTop - lb.y1);
    placed.push({ part: p, x: ox, y: oy, bounds: offset(lb, ox, oy) });
    x = ox + lb.x2 + GAP;
    rowH = Math.max(rowH, oy + lb.y2 - rowTop);
  }

  // Stubs, labels, power symbols, no-connect markers.
  const stubs: PlacedStub[] = [];
  const labels: PlacedLabel[] = [];
  const powers: PlacedPower[] = [];
  const noConnects: PlacedNoConnect[] = [];
  for (const pp of placed) {
    pp.part.symbol.pins.forEach((sp) => {
      const net = netOfPin(pp.part, sp.number);
      const [ex, ey] = pinEnd(pp.x, pp.y, sp);
      if (!net) {
        noConnects.push({ x: ex, y: ey });
        return;
      }
      const out = pinOutwardAngle(sp);
      const [dx, dy] = dirOf(out);
      const sx = round(ex + dx * STUB);
      const sy = round(ey + dy * STUB);
      stubs.push({ x1: ex, y1: ey, x2: sx, y2: sy });
      if (isPower(net)) {
        const rot = ((out - powerBaseAngle(net) + 360) % 360) as PinAngle;
        powers.push({ net, x: sx, y: sy, rotation: rot });
      } else {
        labels.push({ net, x: sx, y: sy, angle: out, justify: out === 0 || out === 90 ? 'left' : 'right' });
      }
    });
  }

  const bounds: Rect = { x1: MARGIN, y1: MARGIN, x2: MARGIN + 50, y2: MARGIN + 30 };
  for (const pp of placed) {
    bounds.x1 = Math.min(bounds.x1, pp.bounds.x1);
    bounds.y1 = Math.min(bounds.y1, pp.bounds.y1);
    bounds.x2 = Math.max(bounds.x2, pp.bounds.x2);
    bounds.y2 = Math.max(bounds.y2, pp.bounds.y2);
  }
  const needW = bounds.x2 + MARGIN;
  const needH = bounds.y2 + MARGIN;
  const paper = PAPERS.find((p) => p.width >= needW && p.height >= needH) ?? PAPERS[PAPERS.length - 1];

  return { parts: placed, stubs, labels, powers, noConnects, bounds, paper };
}

function offset(r: Rect, x: number, y: number): Rect {
  return { x1: r.x1 + x, y1: r.y1 + y, x2: r.x2 + x, y2: r.y2 + y };
}
