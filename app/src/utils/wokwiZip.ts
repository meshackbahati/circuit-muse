/**
 * Wokwi zip import/export
 *
 * Converts between Wokwi's diagram.json format and CircuitMuse's internal
 * project format, bundling everything into a .zip file.
 *
 * Wokwi zip structure:
 *   diagram.json      — parts + connections
 *   sketch.ino        — main sketch (or projectname.ino / main.py)
 *   *.h / *.cpp       — additional files
 *   libraries.txt     — optional library list
 *   wokwi-project.txt — optional metadata
 *
 * diagram.json can only describe ONE board with straight-line wires, so a
 * CircuitMuse export also carries `circuit-muse.vlx` — the full project
 * snapshot (every board, file group, waypoint and property). Wokwi ignores
 * it; CircuitMuse prefers it on import as long as diagram.json was not
 * edited since the export, which makes the zip round-trip lossless.
 */

import JSZip from 'jszip';
import type { Wire } from '../types/wire';
import { BOARD_KIND_LABELS, type BoardKind } from '../types/board';
import {
  buildVlxPayload,
  boardFileGroupId,
  normalizeProjectPayload,
  VlxParseError,
  VLX_FORMAT,
  VLX_VERSION,
  type VlxPayload,
} from './vlxFile';

// ── Type definitions ──────────────────────────────────────────────────────────

interface WokwiPart {
  type: string;
  id: string;
  top: number;
  left: number;
  rotate?: number;
  attrs: Record<string, unknown>;
}

interface WokwiDiagram {
  version: number;
  author: string;
  editor: string;
  parts: WokwiPart[];
  connections: [string, string, string, string[]][];
}

export interface CircuitMuseComponent {
  id: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

export interface WokwiZipImport {
  /** Validated project, ready for `applyProjectPayload`. */
  payload: VlxPayload;
  /** Library names parsed from libraries.txt. Includes both standard Arduino Library Manager names and Wokwi-hosted entries in the form "LibName@wokwi:hash". */
  libraries: string[];
  /** 'circuit-muse' when the embedded full snapshot was used. */
  source: 'circuit-muse' | 'wokwi';
  /** Non-fatal problems (skipped connections etc.) worth telling the user. */
  warnings: string[];
  // Flat views of the main board, kept for callers of the older API.
  boardType: BoardKind | null;
  boardPosition: { x: number; y: number };
  components: CircuitMuseComponent[];
  wires: Wire[];
  files: Array<{ name: string; content: string }>;
}

function withFlatFields(
  payload: VlxPayload,
  libraries: string[],
  source: WokwiZipImport['source'],
  warnings: string[],
): WokwiZipImport {
  const board = payload.boards.find((b) => b.id === payload.activeBoardId) ?? payload.boards[0];
  return {
    payload,
    libraries,
    source,
    warnings,
    boardType: (board?.boardKind as BoardKind) ?? null,
    boardPosition: board ? { x: board.x, y: board.y } : { x: 50, y: 50 },
    components: payload.components,
    wires: payload.wires,
    files: board ? (payload.fileGroups[board.activeFileGroupId] ?? []) : [],
  };
}

/** Name of the full-fidelity snapshot embedded in exported zips. */
export const EMBEDDED_PROJECT_FILE = 'circuit-muse.vlx';

// ── Board mappings ────────────────────────────────────────────────────────────

// Wokwi board part type → CircuitMuse board kind.
const WOKWI_TYPE_TO_BOARD: Record<string, BoardKind> = {
  'wokwi-arduino-uno': 'arduino-uno',
  'wokwi-arduino-nano': 'arduino-nano',
  'wokwi-arduino-mega': 'arduino-mega',
  'wokwi-pi-pico': 'raspberry-pi-pico',
  // Written by earlier CircuitMuse exports.
  'wokwi-raspberry-pi-pico': 'raspberry-pi-pico',
  'wokwi-pi-pico-w': 'pi-pico-w',
  'board-pi-pico-w': 'pi-pico-w',
  'wokwi-esp32-devkit-v1': 'esp32',
  'board-esp32-devkit-c-v4': 'esp32-devkit-c-v4',
  'board-esp32-s3-devkitc-1': 'esp32-s3',
  'board-esp32-c3-devkitm-1': 'esp32-c3',
  'wokwi-attiny85': 'attiny85',
};

// CircuitMuse board kind → Wokwi board part type.
const BOARD_TO_WOKWI_TYPE: Partial<Record<BoardKind, string>> = {
  'arduino-uno': 'wokwi-arduino-uno',
  'arduino-nano': 'wokwi-arduino-nano',
  'arduino-mega': 'wokwi-arduino-mega',
  'raspberry-pi-pico': 'wokwi-pi-pico',
  'pi-pico-w': 'board-pi-pico-w',
  esp32: 'wokwi-esp32-devkit-v1',
  'esp32-devkit-c-v4': 'board-esp32-devkit-c-v4',
  'esp32-s3': 'board-esp32-s3-devkitc-1',
  'esp32-c3': 'board-esp32-c3-devkitm-1',
  attiny85: 'wokwi-attiny85',
};

// CircuitMuse board kind → conventional Wokwi part id.
const BOARD_TO_WOKWI_ID: Partial<Record<BoardKind, string>> = {
  'arduino-uno': 'uno',
  'arduino-nano': 'nano',
  'arduino-mega': 'mega',
  'raspberry-pi-pico': 'pico',
  'pi-pico-w': 'pico',
  esp32: 'esp',
  'esp32-devkit-c-v4': 'esp',
  'esp32-s3': 'esp',
  'esp32-c3': 'esp',
  attiny85: 'tiny',
};

function boardKindFromWokwiType(type: string): BoardKind | undefined {
  if (WOKWI_TYPE_TO_BOARD[type]) return WOKWI_TYPE_TO_BOARD[type];
  // Our own fallback for boards Wokwi has no part for: `board-<kind>`.
  const kind = type.startsWith('board-') ? type.slice(6) : '';
  return kind && Object.prototype.hasOwnProperty.call(BOARD_KIND_LABELS, kind)
    ? (kind as BoardKind)
    : undefined;
}

// ── Pin name aliases ─────────────────────────────────────────────────────────

// Maps Wokwi connection "signal" pin names to wokwi-element physical pin names.
// Wokwi boards (e.g. board-ssd1306) use different naming than the bare elements.
const COMPONENT_PIN_ALIASES: Record<string, Record<string, string>> = {
  ssd1306: {
    SDA: 'DATA',
    SCL: 'CLK',
    VCC: 'VIN',
  },
};

function normalizePinName(metadataId: string, pinName: string): string {
  return COMPONENT_PIN_ALIASES[metadataId]?.[pinName] ?? pinName;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

const COLOR_NAME_TO_HEX: Record<string, string> = {
  red: '#ff0000',
  black: '#000000',
  green: '#00c800',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ff8800',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  purple: '#800080',
  pink: '#ff69b4',
  cyan: '#00ffff',
  gold: '#ffd700',
  brown: '#8b4513',
  magenta: '#ff00ff',
  lime: '#00ff00',
  violet: '#ee82ee',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
};

const HEX_TO_COLOR_NAME: Record<string, string> = {
  '#ff0000': 'red',
  '#000000': 'black',
  '#00ff00': 'green',
  '#00c800': 'green',
  '#0000ff': 'blue',
  '#ffff00': 'yellow',
  '#ff8800': 'orange',
  '#ffffff': 'white',
  '#808080': 'gray',
  '#800080': 'purple',
  '#00ffff': 'cyan',
  '#ffd700': 'gold',
};

function colorToHex(color: unknown): string {
  if (typeof color !== 'string' || !color) return '#888888';
  if (color.startsWith('#')) return color.toLowerCase();
  return COLOR_NAME_TO_HEX[color.toLowerCase()] ?? '#888888';
}

function hexToColorName(hex: string): string {
  return HEX_TO_COLOR_NAME[hex.toLowerCase()] ?? hex;
}

// ── Type conversion ───────────────────────────────────────────────────────────

function wokwiTypeToMetadataId(type: string): string {
  if (type.startsWith('wokwi-')) return type.slice(6);
  if (type.startsWith('board-')) return type.slice(6);
  return type;
}

function metadataIdToWokwiType(metadataId: string): string {
  if (metadataId.startsWith('wokwi-') || metadataId.startsWith('board-')) return metadataId;
  return `wokwi-${metadataId}`;
}

/** Small stable hash (FNV-1a) used to detect edits to diagram.json. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── Library list parser ───────────────────────────────────────────────────────

/**
 * Parse the contents of a Wokwi libraries.txt file.
 * - Strips blank lines and # comments
 * - Includes Wokwi-hosted entries in the form  name@wokwi:hash
 *   so the backend can download and install them from wokwi.com
 */
export function parseLibrariesTxt(content: string): string[] {
  const libs: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    libs.push(line);
  }
  return libs;
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Build the Wokwi diagram for a project snapshot. Uses the active board (or
 * the first one); parts belonging to other boards stay in the diagram but
 * wires to those other boards are left out because Wokwi can't express them.
 */
export function buildWokwiDiagram(payload: VlxPayload): WokwiDiagram {
  const board =
    payload.boards.find((b) => b.id === payload.activeBoardId) ?? payload.boards[0];
  const parts: WokwiPart[] = [];
  const partIdMap = new Map<string, string>();
  const takenIds = new Set(payload.components.map((c) => c.id));

  if (board) {
    const kind = board.boardKind as BoardKind;
    let partId = BOARD_TO_WOKWI_ID[kind] ?? 'board';
    while (takenIds.has(partId)) partId = `${partId}-board`;
    partIdMap.set(board.id, partId);
    parts.push({
      type: BOARD_TO_WOKWI_TYPE[kind] ?? `board-${kind}`,
      id: partId,
      top: Math.round(board.y),
      left: Math.round(board.x),
      attrs: {},
    });
  }

  for (const c of payload.components) {
    const { rotation, ...rest } = (c.properties ?? {}) as Record<string, unknown>;
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined || v === null) continue;
      // Wokwi attrs are flat strings; nested values only live in the snapshot.
      attrs[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const part: WokwiPart = {
      type: metadataIdToWokwiType(c.metadataId),
      id: c.id,
      top: Math.round(c.y),
      left: Math.round(c.x),
      attrs,
    };
    if (typeof rotation === 'number' && rotation % 360 !== 0) part.rotate = rotation;
    parts.push(part);
    partIdMap.set(c.id, c.id);
  }

  const connections: WokwiDiagram['connections'] = [];
  for (const w of payload.wires) {
    const a = partIdMap.get(w.start.componentId);
    const b = partIdMap.get(w.end.componentId);
    if (!a || !b) continue; // wire to a board Wokwi can't hold
    connections.push([
      `${a}:${w.start.pinName}`,
      `${b}:${w.end.pinName}`,
      hexToColorName(w.color ?? '#888888'),
      [],
    ]);
  }

  return { version: 1, author: 'CircuitMuse', editor: 'wokwi', parts, connections };
}

/** Build the .zip for a snapshot (defaults to the current workspace). */
export async function buildWokwiZipBlob(
  payload: VlxPayload = buildVlxPayload(),
): Promise<Blob> {
  const zip = new JSZip();
  const diagramText = JSON.stringify(buildWokwiDiagram(payload), null, 2);
  zip.file('diagram.json', diagramText);
  zip.file(
    'wokwi-project.txt',
    `Exported from CircuitMuse\n\nSimulate this project on https://circuit-muse.dev\n`,
  );

  // Sketch files of the board that went into diagram.json.
  const board = payload.boards.find((b) => b.id === payload.activeBoardId) ?? payload.boards[0];
  const files = board ? (payload.fileGroups[board.activeFileGroupId] ?? []) : [];
  for (const f of files) {
    if (f.name === EMBEDDED_PROJECT_FILE || f.name === 'diagram.json') continue;
    zip.file(f.name, f.content);
  }
  const libraries = board?.libraries ?? [];
  if (libraries.length && !files.some((f) => f.name === 'libraries.txt')) {
    zip.file('libraries.txt', libraries.join('\n') + '\n');
  }

  zip.file(
    EMBEDDED_PROJECT_FILE,
    JSON.stringify({ ...payload, wokwiDiagramHash: hashText(diagramText) }, null, 2),
  );
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Export the current workspace as a Wokwi zip and trigger a download.
 * The legacy positional arguments are ignored: the whole project is read
 * from the stores so nothing (multi-board, waypoints, chips) is lost.
 */
export async function exportToWokwiZip(projectName: string): Promise<void> {
  const blob = await buildWokwiZipBlob(buildVlxPayload({ name: projectName }));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const base = (projectName || 'circuit-muse-project').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  a.download = `${base || 'circuit-muse-project'}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Import ────────────────────────────────────────────────────────────────────

const CODE_EXTS = new Set(['.ino', '.h', '.hpp', '.cpp', '.c', '.py']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a Wokwi (or CircuitMuse-exported) zip into a validated project.
 * Does NOT touch the stores — call `applyProjectPayload` with the result.
 */
export async function importFromWokwiZip(file: File | Blob): Promise<WokwiZipImport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new VlxParseError(`This is not a valid .zip file (${(err as Error).message}).`);
  }

  // diagram.json is required (at the root, or inside a single top folder).
  const diagramPath =
    zip.file('diagram.json')?.name ??
    Object.keys(zip.files).find((n) => n.endsWith('/diagram.json') && !n.startsWith('__MACOSX'));
  if (!diagramPath) throw new VlxParseError('No diagram.json found in the zip file.');
  const root = diagramPath.slice(0, diagramPath.length - 'diagram.json'.length);
  const diagramText = await zip.file(diagramPath)!.async('string');

  // Parse libraries.txt
  const libraries: string[] = [];
  const libEntry = zip.file(`${root}libraries.txt`);
  if (libEntry) {
    libraries.push(...parseLibrariesTxt(await libEntry.async('string')));
  }

  // Lossless path: our own snapshot, if diagram.json wasn't edited since.
  const embedded = zip.file(`${root}${EMBEDDED_PROJECT_FILE}`);
  if (embedded) {
    try {
      const raw = JSON.parse(await embedded.async('string')) as Record<string, unknown>;
      if (raw.wokwiDiagramHash === hashText(diagramText)) {
        delete raw.wokwiDiagramHash;
        return withFlatFields(normalizeProjectPayload(raw), libraries, 'circuit-muse', []);
      }
    } catch {
      // Fall through to the plain Wokwi conversion below.
    }
  }

  let diagram: unknown;
  try {
    diagram = JSON.parse(diagramText.charCodeAt(0) === 0xfeff ? diagramText.slice(1) : diagramText);
  } catch (err) {
    throw new VlxParseError(`diagram.json is not valid JSON: ${(err as Error).message}`);
  }
  if (!isPlainObject(diagram) || !Array.isArray(diagram.parts)) {
    throw new VlxParseError('diagram.json has no "parts" list.');
  }
  const warnings: string[] = [];
  const rawParts = diagram.parts.filter(
    (p): p is Record<string, unknown> =>
      isPlainObject(p) && typeof p.type === 'string' && typeof p.id === 'string' && p.id !== '',
  );
  if (rawParts.length !== diagram.parts.length) {
    warnings.push(`${diagram.parts.length - rawParts.length} invalid part(s) were skipped.`);
  }

  // Read code files.
  const files: Array<{ name: string; content: string }> = [];
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir || filename.startsWith('__MACOSX')) continue;
    const basename = filename.split('/').pop() ?? filename;
    const dot = basename.lastIndexOf('.');
    const ext = dot >= 0 ? basename.slice(dot).toLowerCase() : '';
    if (!CODE_EXTS.has(ext) || files.some((f) => f.name === basename)) continue;
    files.push({ name: basename, content: await entry.async('string') });
  }
  // Main file first (.ino, or main.py for MicroPython), then alphabetically.
  const rank = (n: string) => (n.endsWith('.ino') ? 0 : n === 'main.py' ? 1 : 2);
  files.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const codeIsPython = files.length > 0 && !files.some((f) => f.name.endsWith('.ino')) && files.some((f) => f.name.endsWith('.py'));

  const hasCode = files.some((f) => f.content.trim() !== '');

  // Detect board
  const boardPart = rawParts.find((p) => boardKindFromWokwiType(p.type as string));
  let boardKind = boardPart ? boardKindFromWokwiType(boardPart.type as string) : undefined;
  if (!boardKind && hasCode) {
    // Keep the code reachable: fall back to a default board, as before.
    boardKind = codeIsPython ? 'raspberry-pi-pico' : 'arduino-uno';
    warnings.push(`No supported board was found in diagram.json; the code was loaded onto a ${BOARD_KIND_LABELS[boardKind]}.`);
  }
  const boardId = boardKind ?? null; // first board of a kind uses its kind as id

  // Board position from diagram. Apply a minimum offset so the board is never
  // crammed against the canvas top-left corner (Wokwi diagrams often use 0,0).
  const MIN_OFFSET = 50;
  const rawBoardX = boardPart ? num(boardPart.left, MIN_OFFSET) : MIN_OFFSET;
  const rawBoardY = boardPart ? num(boardPart.top, MIN_OFFSET) : MIN_OFFSET;
  const offsetX = rawBoardX < MIN_OFFSET ? MIN_OFFSET - rawBoardX : 0;
  const offsetY = rawBoardY < MIN_OFFSET ? MIN_OFFSET - rawBoardY : 0;

  // Convert non-board parts to CircuitMuse components.
  const usedIds = new Set<string>(boardId ? [boardId] : []);
  const idMap = new Map<string, string>();
  if (boardPart && boardId) idMap.set(boardPart.id as string, boardId);
  const components: CircuitMuseComponent[] = [];
  for (const p of rawParts) {
    if (p === boardPart) continue;
    if (boardKindFromWokwiType(p.type as string)) {
      warnings.push(`Extra board "${p.id}" (${p.type}) was skipped: Wokwi diagrams hold one board.`);
      continue;
    }
    let id = p.id as string;
    while (usedIds.has(id)) id = `${id}-1`;
    usedIds.add(id);
    idMap.set(p.id as string, id);
    const properties: Record<string, unknown> = isPlainObject(p.attrs) ? { ...p.attrs } : {};
    const rotate = num(p.rotate, 0);
    if (rotate) properties.rotation = rotate;
    components.push({
      id,
      metadataId: wokwiTypeToMetadataId(p.type as string),
      x: num(p.left, 0) + offsetX,
      y: num(p.top, 0) + offsetY,
      properties,
    });
  }

  // Convert connections to CircuitMuse wires
  const wires: Wire[] = [];
  const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
  let skipped = 0;
  connections.forEach((conn, i) => {
    if (!Array.isArray(conn) || typeof conn[0] !== 'string' || typeof conn[1] !== 'string') {
      skipped++;
      return;
    }
    const [startStr, endStr, color] = conn as [string, string, unknown];
    const split = (s: string) => {
      const colon = s.indexOf(':');
      return colon >= 0 ? [s.slice(0, colon), s.slice(colon + 1)] : [s, ''];
    };
    const [startRaw, startPin] = split(startStr);
    const [endRaw, endPin] = split(endStr);
    const startId = idMap.get(startRaw);
    const endId = idMap.get(endRaw);
    if (!startId || !endId) {
      skipped++;
      return;
    }
    const metaOf = (id: string) => components.find((c) => c.id === id)?.metadataId ?? '';
    wires.push({
      id: `wire-${i}-${Date.now().toString(36)}`,
      start: { componentId: startId, pinName: normalizePinName(metaOf(startId), startPin), x: 0, y: 0 },
      end: { componentId: endId, pinName: normalizePinName(metaOf(endId), endPin), x: 0, y: 0 },
      waypoints: [],
      color: colorToHex(color),
    });
  });
  if (skipped) warnings.push(`${skipped} connection(s) pointed at unknown parts and were skipped.`);

  const raw = {
    format: VLX_FORMAT,
    version: VLX_VERSION,
    boards: boardId
      ? [
          {
            id: boardId,
            boardKind: boardKind!,
            x: rawBoardX + offsetX,
            y: rawBoardY + offsetY,
            activeFileGroupId: boardFileGroupId(boardId),
            languageMode: codeIsPython ? 'micropython' : 'arduino',
          },
        ]
      : [],
    fileGroups: boardId ? { [boardFileGroupId(boardId)]: files } : {},
    components,
    wires,
    activeBoardId: boardId,
  };
  return withFlatFields(normalizeProjectPayload(raw), libraries, 'wokwi', warnings);
}
