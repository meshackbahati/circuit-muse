/**
 * Fritzing .fzz file import.
 *
 * A .fzz is a ZIP holding the sketch XML (.fz), the Arduino program(s) it
 * references and any custom part files. In the .fz:
 *
 *   <instances>
 *     <instance moduleIdRef="ResistorModuleID" modelIndex="5797">
 *       <property name="resistance" value="220Ω"/>
 *       <title>R1</title>
 *       <views><breadboardView>
 *         <geometry x=".." y=".."><transform m11 m12 m21 m22 .../></geometry>
 *         <connectors><connector connectorId="connector0">
 *           <connects><connect connectorId="connector0" modelIndex="5800"/></connects>
 *         </connector></connectors>
 *       </breadboardView></views>
 *     </instance>
 *     <instance moduleIdRef="WireModuleID" ...>   ← breadboard wires are parts too
 *   </instances>
 *   <programs><program language="Arduino">Blink.ino</program></programs>
 *
 * We map the parts CircuitMuse has an equivalent for, follow chains of wire
 * segments to find which part pins they join (bends become waypoints), and
 * build a normal project snapshot. Parts or pins we can't map are skipped and
 * reported in `warnings` rather than crashing the import.
 *
 * A simplified layout (`<wire fromPart= fromConnectorId= toPart= toConnectorId=>`
 * and `<program><code>…</code></program>`) is also accepted.
 */

import JSZip from 'jszip';
import type { BoardKind } from '../types/board';
import type { Wire } from '../types/wire';
import {
  applyProjectPayload,
  boardFileGroupId,
  normalizeProjectPayload,
  VlxParseError,
  VLX_FORMAT,
  VLX_VERSION,
  type VlxPayload,
} from './vlxFile';

/** Fritzing breadboard coordinates are a bit larger than our canvas units. */
const SCALE = 0.75;

type PartMapping =
  | { kind: 'board'; boardKind: BoardKind }
  | { kind: 'component'; metadataId: string; pins?: Record<string, string> }
  | { kind: 'wire' }
  | { kind: 'ignore' };

// Simplified layout ids (wokwi-style module refs).
const LEGACY_MODULES: Record<string, PartMapping> = {
  'wokwi-arduino-uno': { kind: 'board', boardKind: 'arduino-uno' },
  'wokwi-arduino-nano': { kind: 'board', boardKind: 'arduino-nano' },
  'wokwi-arduino-mega': { kind: 'board', boardKind: 'arduino-mega' },
  'wokwi-pi-pico': { kind: 'board', boardKind: 'raspberry-pi-pico' },
  'wokwi-dht22': { kind: 'component', metadataId: 'dht22' },
  'wokwi-hcsr04': { kind: 'component', metadataId: 'hc-sr04' },
};

/** Map a Fritzing module id to a CircuitMuse board/part, or null if unknown. */
function mapModule(moduleIdRef: string): PartMapping | null {
  if (LEGACY_MODULES[moduleIdRef]) return LEGACY_MODULES[moduleIdRef];
  if (moduleIdRef.startsWith('wokwi-')) {
    return { kind: 'component', metadataId: moduleIdRef.slice(6) };
  }
  const id = moduleIdRef.toLowerCase();
  if (id === 'wiremoduleid') return { kind: 'wire' };
  if (/breadboard|powerlabel|groundmodule|netlabel|note|logo|ruler/.test(id)) return { kind: 'ignore' };
  if (/arduino[\W_]*uno/.test(id)) return { kind: 'board', boardKind: 'arduino-uno' };
  if (/arduino[\W_]*nano/.test(id)) return { kind: 'board', boardKind: 'arduino-nano' };
  if (/arduino[\W_]*mega/.test(id)) return { kind: 'board', boardKind: 'arduino-mega' };
  if (/pico/.test(id)) return { kind: 'board', boardKind: 'raspberry-pi-pico' };
  if (/esp32/.test(id)) return { kind: 'board', boardKind: 'esp32' };
  if (id === 'resistormoduleid' || /^resistor/.test(id)) {
    return { kind: 'component', metadataId: 'resistor', pins: { connector0: '1', connector1: '2' } };
  }
  // Fritzing core LEDs: connector0 = cathode, connector1 = anode.
  if (/led/.test(id) && !/rgb|matrix|bar|segment|strip|neopixel/.test(id)) {
    return { kind: 'component', metadataId: 'led', pins: { connector0: 'C', connector1: 'A' } };
  }
  if (/potentiometer|trimmer/.test(id)) return { kind: 'component', metadataId: 'potentiometer' };
  if (/push[\W_]*button|tactile/.test(id)) return { kind: 'component', metadataId: 'pushbutton' };
  if (/piezo|buzzer/.test(id)) return { kind: 'component', metadataId: 'buzzer' };
  if (/servo/.test(id)) return { kind: 'component', metadataId: 'servo' };
  return null;
}

export interface FritzingPart {
  /** modelIndex (or legacy id) — what wires reference. */
  id: string;
  title: string;
  moduleIdRef: string;
  x: number;
  y: number;
  rotation: number;
  properties: Record<string, string>;
}

export interface FritzingWire {
  fromPart: string;
  fromPin: string;
  toPart: string;
  toPin: string;
  color: string;
  waypoints: Array<{ x: number; y: number }>;
}

export interface FritzingImportResult {
  /** Board kind found in the sketch, or null for a board-less circuit. */
  boardType: string | null;
  parts: FritzingPart[];
  wires: FritzingWire[];
  code: string;
  /** File name the program had inside the .fzz (defaults to sketch.ino). */
  codeFileName: string;
  libraries: string[];
  warnings: string[];
}

// ─── XML helpers ──────────────────────────────────────────────────────────

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

function child(el: Element | undefined | null, name: string): Element | undefined {
  return el ? children(el, name)[0] : undefined;
}

function num(value: string | null | undefined, fallback = 0): number {
  const n = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new VlxParseError('The Fritzing sketch (.fz) is not valid XML.');
  }
  return doc;
}

interface RawInstance {
  key: string;
  moduleIdRef: string;
  title: string;
  properties: Record<string, string>;
  bb: Element | undefined;
  x: number;
  y: number;
  rotation: number;
  /** connectorId → list of { instance key, connectorId } it touches. */
  connects: Map<string, Array<{ key: string; connectorId: string }>>;
}

function readInstance(el: Element): RawInstance {
  const key = el.getAttribute('modelIndex') || el.getAttribute('id') || '';
  const properties: Record<string, string> = {};
  for (const p of children(el, 'property')) {
    const name = p.getAttribute('name');
    if (name) properties[name] = p.getAttribute('value') ?? '';
  }
  const title = child(el, 'title')?.textContent?.trim() ?? '';
  const bb = child(child(el, 'views'), 'breadboardView');

  let x = 0, y = 0, rotation = 0;
  const geometry = child(bb, 'geometry');
  if (geometry) {
    x = num(geometry.getAttribute('x'));
    y = num(geometry.getAttribute('y'));
    const t = child(geometry, 'transform');
    if (t) {
      rotation = Math.round((Math.atan2(num(t.getAttribute('m12')), num(t.getAttribute('m11'), 1)) * 180) / Math.PI);
    }
  } else {
    // Simplified layout: <breadboardView><svg transform="translate(x, y) rotate(r)"/>
    const transform = child(bb, 'svg')?.getAttribute('transform') ?? '';
    const tr = transform.match(/translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)/);
    if (tr) {
      x = num(tr[1]);
      y = num(tr[2]);
    }
    const rot = transform.match(/rotate\(\s*([-\d.eE]+)/);
    if (rot) rotation = num(rot[1]);
  }

  const connects = new Map<string, Array<{ key: string; connectorId: string }>>();
  for (const c of children(child(bb, 'connectors') ?? el.ownerDocument.createElement('x'), 'connector')) {
    const cid = c.getAttribute('connectorId');
    if (!cid) continue;
    const list = children(child(c, 'connects') ?? c.ownerDocument.createElement('x'), 'connect')
      .map((k) => ({ key: k.getAttribute('modelIndex') ?? '', connectorId: k.getAttribute('connectorId') ?? '' }))
      .filter((k) => k.key && k.connectorId);
    connects.set(cid, list);
  }
  return { key, moduleIdRef: el.getAttribute('moduleIdRef') ?? '', title, properties, bb, x, y, rotation, connects };
}

/** Absolute position of a wire instance's end (connector0 / connector1). */
function wireEndPoint(w: RawInstance, connectorId: string): { x: number; y: number } {
  const g = child(w.bb, 'geometry');
  const end = connectorId === 'connector1' ? '2' : '1';
  return {
    x: (w.x + num(g?.getAttribute(`x${end}`))) * SCALE,
    y: (w.y + num(g?.getAttribute(`y${end}`))) * SCALE,
  };
}

/**
 * Follow chains of breadboard wire segments and return one connection per
 * pair of part pins they join. Bends between segments become waypoints.
 */
function resolveWires(instances: Map<string, RawInstance>): { wires: FritzingWire[]; branched: number } {
  const isWire = (key: string) => instances.get(key)?.moduleIdRef === 'WireModuleID';
  const wires: FritzingWire[] = [];
  const visited = new Set<string>();
  let branched = 0;

  for (const start of instances.values()) {
    if (start.moduleIdRef !== 'WireModuleID' || visited.has(start.key) || !start.bb) continue;

    // Collect the connected group of wire segments.
    const group: RawInstance[] = [];
    const queue = [start];
    visited.add(start.key);
    while (queue.length) {
      const w = queue.shift()!;
      group.push(w);
      for (const list of w.connects.values()) {
        for (const c of list) {
          const other = instances.get(c.key);
          if (other && isWire(c.key) && other.bb && !visited.has(c.key)) {
            visited.add(c.key);
            queue.push(other);
          }
        }
      }
    }

    // Part pins touched by the group.
    const endpoints: Array<{ wire: RawInstance; wireConnector: string; key: string; pin: string }> = [];
    for (const w of group) {
      for (const [cid, list] of w.connects) {
        for (const c of list) {
          if (!isWire(c.key) && instances.has(c.key)) {
            endpoints.push({ wire: w, wireConnector: cid, key: c.key, pin: c.connectorId });
          }
        }
      }
    }
    if (endpoints.length < 2) continue;
    const color = child(start.bb, 'wireExtras')?.getAttribute('color') || '#418dd9';

    if (endpoints.length === 2) {
      // Walk the chain from the first endpoint to collect bend points.
      const waypoints: Array<{ x: number; y: number }> = [];
      let cur: RawInstance | undefined = endpoints[0].wire;
      let entered = endpoints[0].wireConnector;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.key)) {
        seen.add(cur.key);
        const exit = entered === 'connector0' ? 'connector1' : 'connector0';
        const next = (cur.connects.get(exit) ?? []).find((c) => isWire(c.key) && !seen.has(c.key));
        if (!next) break;
        waypoints.push(wireEndPoint(cur, exit));
        cur = instances.get(next.key);
        entered = next.connectorId;
      }
      wires.push({
        fromPart: endpoints[0].key,
        fromPin: endpoints[0].pin,
        toPart: endpoints[1].key,
        toPin: endpoints[1].pin,
        color,
        waypoints,
      });
    } else {
      // A branching net: join every pin to the first one, straight lines.
      branched++;
      for (let i = 1; i < endpoints.length; i++) {
        wires.push({
          fromPart: endpoints[0].key,
          fromPin: endpoints[0].pin,
          toPart: endpoints[i].key,
          toPin: endpoints[i].pin,
          color,
          waypoints: [],
        });
      }
    }
  }
  return { wires, branched };
}

// ─── Main import function ─────────────────────────────────────────────────

export async function importFritzingFile(file: File | Blob): Promise<FritzingImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new VlxParseError(`This is not a valid Fritzing .fzz file (${(err as Error).message}).`);
  }

  const fzFile = Object.keys(zip.files).find(
    (name) => name.toLowerCase().endsWith('.fz') && !name.startsWith('__MACOSX'),
  );
  if (!fzFile) {
    throw new VlxParseError('No Fritzing sketch (.fz) found in the .fzz file.');
  }
  const doc = parseXml(await zip.file(fzFile)!.async('text'));
  const warnings: string[] = [];

  // Parts (every <instance>, including wire segments).
  const instances = new Map<string, RawInstance>();
  for (const el of Array.from(doc.getElementsByTagName('instance'))) {
    const inst = readInstance(el);
    if (inst.key && !instances.has(inst.key)) instances.set(inst.key, inst);
  }

  const parts: FritzingPart[] = [];
  for (const inst of instances.values()) {
    if (inst.moduleIdRef === 'WireModuleID') continue;
    if (!inst.bb && !inst.moduleIdRef.startsWith('wokwi-')) continue; // schematic/PCB-only item
    parts.push({
      id: inst.key,
      title: inst.title,
      moduleIdRef: inst.moduleIdRef,
      x: inst.x * SCALE,
      y: inst.y * SCALE,
      rotation: inst.rotation,
      properties: inst.properties,
    });
  }

  // Wires: real breadboard wire chains + the simplified <wire> layout.
  const { wires, branched } = resolveWires(instances);
  if (branched) warnings.push(`${branched} branching wire net(s) were drawn as straight lines.`);
  for (const el of Array.from(doc.getElementsByTagName('wire'))) {
    const fromPart = el.getAttribute('fromPart') ?? '';
    const fromPin = el.getAttribute('fromConnectorId') ?? '';
    const toPart = el.getAttribute('toPart') ?? '';
    const toPin = el.getAttribute('toConnectorId') ?? '';
    if (fromPart && fromPin && toPart && toPin) {
      wires.push({ fromPart, fromPin, toPart, toPin, color: el.getAttribute('color') || 'green', waypoints: [] });
    }
  }

  // Program: <program> holds a path to the .ino inside the .fzz (or, in the
  // simplified layout, a <code> child with the source itself).
  let code = '';
  let codeFileName = 'sketch.ino';
  const findInZip = (path: string) => {
    const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
    return Object.keys(zip.files).find(
      (n) => !n.startsWith('__MACOSX') && (n === path || n.split('/').pop() === base),
    );
  };
  for (const el of Array.from(doc.getElementsByTagName('program'))) {
    const codeEl = child(el, 'code');
    if (codeEl) {
      code = codeEl.textContent ?? '';
      break;
    }
    const path = el.textContent?.trim() ?? '';
    const hit = path ? findInZip(path) : undefined;
    if (hit) {
      code = await zip.file(hit)!.async('text');
      codeFileName = hit.split('/').pop()!;
      break;
    }
    if (path) warnings.push(`The program "${path}" is not inside the .fzz file.`);
  }
  if (!code) {
    const inoFile = Object.keys(zip.files).find(
      (name) => name.toLowerCase().endsWith('.ino') && !name.startsWith('__MACOSX'),
    );
    if (inoFile) {
      code = await zip.file(inoFile)!.async('text');
      codeFileName = inoFile.split('/').pop()!;
    }
  }
  if (!codeFileName.toLowerCase().endsWith('.ino')) codeFileName = 'sketch.ino';

  // libraries.txt (if the author added one)
  const libraries: string[] = [];
  const libFile = Object.keys(zip.files).find(
    (name) => name === 'libraries.txt' || name.endsWith('/libraries.txt'),
  );
  if (libFile) {
    for (const line of (await zip.file(libFile)!.async('text')).split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) libraries.push(trimmed);
    }
  }

  // Board type: first part that maps to a board.
  let boardType: string | null = null;
  for (const part of parts) {
    const m = mapModule(part.moduleIdRef);
    if (m?.kind === 'board') {
      boardType = m.boardKind;
      break;
    }
  }

  return { boardType, parts, wires, code, codeFileName, libraries, warnings };
}

// ─── Convert to a project ─────────────────────────────────────────────────

function componentProperties(metadataId: string, fz: Record<string, string>, rotation: number) {
  const props: Record<string, unknown> = {};
  if (metadataId === 'resistor' && fz.resistance) {
    // "220Ω", "4.7kΩ" → "220", "4.7k"
    props.resistance = fz.resistance.replace(/\s*(Ω|ohms?)\s*$/i, '').trim();
  }
  if (metadataId === 'led' && fz.color) {
    const c = fz.color.split(/[\s(]/)[0].toLowerCase();
    if (c) props.color = c;
  }
  if (rotation % 360 !== 0) props.rotation = rotation;
  return props;
}

/**
 * Build a validated project snapshot from a parsed Fritzing sketch. Unknown
 * parts and pins that have no CircuitMuse equivalent are skipped and listed
 * in `result.warnings` (the array is extended in place).
 */
export function buildFritzingPayload(result: FritzingImportResult): VlxPayload {
  const warnings = result.warnings;
  let boardKind = result.boardType as BoardKind | null;
  if (!boardKind && result.code.trim()) {
    // Fritzing programs are Arduino sketches; keep the code reachable.
    boardKind = 'arduino-uno';
    warnings.push('No supported board was found in the sketch; the program was loaded onto an Arduino Uno.');
  }
  const boardId = boardKind ?? null;
  // Fritzing part key → { CircuitMuse id, pin map (undefined = pass through) }
  const refs = new Map<string, { id: string; pins?: Record<string, string>; board: boolean }>();
  const usedIds = new Set<string>(boardId ? [boardId] : []);
  const components: Array<Record<string, unknown>> = [];
  const unknown = new Map<string, number>();
  let boardX = 200, boardY = 200;
  let boardPlaced = false;

  for (const part of result.parts) {
    const m = mapModule(part.moduleIdRef);
    if (!m) {
      unknown.set(part.moduleIdRef, (unknown.get(part.moduleIdRef) ?? 0) + 1);
      continue;
    }
    if (m.kind === 'ignore' || m.kind === 'wire') continue;
    const legacy = part.moduleIdRef.startsWith('wokwi-');
    if (m.kind === 'board') {
      if (m.boardKind === boardKind && !boardPlaced && boardId) {
        boardPlaced = true;
        boardX = part.x;
        boardY = part.y;
        // Board pins can only be matched in the simplified layout, which
        // already uses our pin names; real Fritzing connector ids can't be.
        refs.set(part.id, { id: boardId, pins: legacy ? undefined : {}, board: true });
      } else {
        warnings.push(`Extra board "${part.title || part.moduleIdRef}" was skipped (one board per import).`);
      }
      continue;
    }
    let id = (part.title || `fz-${part.id}`).replace(/[^\p{L}\p{N}_-]+/gu, '-') || `fz-${part.id}`;
    while (usedIds.has(id)) id = `${id}-${part.id}`;
    usedIds.add(id);
    refs.set(part.id, { id, pins: legacy ? undefined : m.pins ?? {}, board: false });
    components.push({
      id,
      metadataId: m.metadataId,
      x: part.x,
      y: part.y,
      properties: componentProperties(m.metadataId, part.properties, part.rotation),
    });
  }
  for (const [mod, count] of unknown) {
    warnings.push(`${count} × "${mod}" has no CircuitMuse equivalent and was skipped.`);
  }

  const wires: Wire[] = [];
  let unmapped = 0;
  result.wires.forEach((w, i) => {
    const a = refs.get(w.fromPart);
    const b = refs.get(w.toPart);
    const pinA = a ? (a.pins ? a.pins[w.fromPin] : w.fromPin) : undefined;
    const pinB = b ? (b.pins ? b.pins[w.toPin] : w.toPin) : undefined;
    if (!a || !b || !pinA || !pinB) {
      unmapped++;
      return;
    }
    wires.push({
      id: `fritzing-wire-${i}`,
      start: { componentId: a.id, pinName: pinA, x: 0, y: 0 },
      end: { componentId: b.id, pinName: pinB, x: 0, y: 0 },
      waypoints: w.waypoints,
      color: w.color.startsWith('#') ? w.color : w.color || '#22c55e',
    });
  });
  if (unmapped) {
    warnings.push(`${unmapped} wire(s) connect to parts or pins CircuitMuse can't match and were skipped.`);
  }

  const raw = {
    format: VLX_FORMAT,
    version: VLX_VERSION,
    boards: boardId
      ? [
          {
            id: boardId,
            boardKind: boardKind!,
            x: boardX,
            y: boardY,
            activeFileGroupId: boardFileGroupId(boardId),
          },
        ]
      : [],
    fileGroups: boardId
      ? { [boardFileGroupId(boardId)]: [{ name: result.codeFileName || 'sketch.ino', content: result.code }] }
      : {},
    components,
    wires,
    activeBoardId: boardId,
  };
  return normalizeProjectPayload(raw);
}

/** Replace the workspace with the Fritzing sketch (restores it on failure). */
export function loadFritzingIntoStores(result: FritzingImportResult): VlxPayload {
  const payload = buildFritzingPayload(result);
  applyProjectPayload(payload);
  return payload;
}
