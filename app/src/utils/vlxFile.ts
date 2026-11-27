/**
 * .vlx file format — portable project export/import for OSS CircuitMuse.
 *
 * The Desktop app has no server-side project persistence, so `.vlx` is the
 * single-file JSON snapshot that round-trips a whole workspace:
 *
 *   {
 *     "format": "circuit-muse-project",
 *     "version": 1,
 *     "exportedAt": "ISO timestamp",
 *     "name": "project name (optional)",
 *     "boards": [...],                 // incl. board options, SPIFFS, libraries
 *     "fileGroups": { "<groupId>": [{ name, content }, ...] },
 *     "components": [...],
 *     "wires": [...],                  // incl. waypoints + colour
 *     "activeBoardId": "..." | null,
 *     "messages": [...],               // optional — project chat history
 *     "uploads": [...]                 // optional — files attached to the chat
 *   }
 *
 * Every field added after the first release is optional, so files written by
 * older versions (and by the earlier "velxio-project" brand) still load.
 *
 * Reading: `parseVlxFile(File)` / `normalizeProjectPayload(data)` validate and
 *  normalise into a shape directly consumable by `applyProjectPayload`.
 * Writing: `buildVlxPayload()` snapshots the current store state.
 */

import type { BoardInstance, BoardKind, LanguageMode } from '../types/board';
import { BOARD_KIND_LABELS } from '../types/board';
import type { Wire } from '../types/wire';
import type { Message } from '../agent/types';
import { useEditorStore, chipFileGroupId } from '../store/useEditorStore';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useAgentStore } from '../store/useAgentStore';
import { useUploadsStore, type UploadedFile } from '../store/useUploadsStore';

// Component is private to the simulator store, so derive its shape from there.
type Component = ReturnType<typeof useSimulatorStore.getState>['components'][number];

export const VLX_FORMAT = 'circuit-muse-project';
/** Format name written by the project's earlier (Velxio-branded) releases. */
const LEGACY_VLX_FORMATS = new Set(['velxio-project']);
export const VLX_VERSION = 1;

export interface VlxBoard {
  id: string;
  name?: string;
  boardKind: string;
  x: number;
  y: number;
  activeFileGroupId: string;
  languageMode?: string;
  serialBaudRate?: number;
  boardOptions?: BoardInstance['boardOptions'];
  spiffsFiles?: BoardInstance['spiffsFiles'];
  libraries?: string[];
}

export interface VlxPayload {
  format: typeof VLX_FORMAT;
  version: number;
  exportedAt: string;
  name?: string;
  boards: VlxBoard[];
  fileGroups: Record<string, Array<{ name: string; content: string }>>;
  components: Component[];
  wires: Wire[];
  activeBoardId: string | null;
  messages?: Message[];
  uploads?: UploadedFile[];
}

function serialisableBoard(b: BoardInstance): VlxBoard {
  const out: VlxBoard = {
    id: b.id,
    name: b.name,
    boardKind: b.boardKind,
    x: b.x,
    y: b.y,
    activeFileGroupId: b.activeFileGroupId,
    languageMode: b.languageMode,
    serialBaudRate: b.serialBaudRate,
  };
  // Persistent per-board settings. Leaving these out silently reset ESP32
  // board options, SPIFFS images and the board's library manifest on import.
  if (b.boardOptions) out.boardOptions = b.boardOptions;
  if (b.spiffsFiles) out.spiffsFiles = b.spiffsFiles;
  if (b.libraries) out.libraries = b.libraries;
  return out;
}

/**
 * Snapshot the current editor + simulator + chat state into a VlxPayload.
 * Pure function: no side effects.
 */
export function buildVlxPayload(
  opts: { name?: string; includeChat?: boolean } = {},
): VlxPayload {
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();

  // Persist file groups referenced by a board, plus each programmable chip's
  // own program group (group-chip-<id>) — otherwise the chip's program would
  // be dropped on export. Stray groups from deleted boards don't round-trip.
  const referencedGroupIds = new Set(sim.boards.map((b) => b.activeFileGroupId));
  for (const c of sim.components) {
    if (c.metadataId !== 'custom-chip') continue;
    const gid = chipFileGroupId(c.id);
    if (editor.fileGroups[gid]?.length) referencedGroupIds.add(gid);
  }
  const fileGroups: VlxPayload['fileGroups'] = {};
  for (const gid of referencedGroupIds) {
    fileGroups[gid] = (editor.fileGroups[gid] ?? []).map((f) => ({
      name: f.name,
      content: f.content,
    }));
  }

  const payload: VlxPayload = {
    format: VLX_FORMAT,
    version: VLX_VERSION,
    exportedAt: new Date().toISOString(),
    name: opts.name,
    boards: sim.boards.map(serialisableBoard),
    fileGroups,
    components: sim.components,
    wires: sim.wires,
    activeBoardId: sim.activeBoardId,
  };
  if (opts.includeChat !== false) {
    const messages = useAgentStore.getState().messages;
    const uploads = useUploadsStore.getState().files;
    if (messages.length) payload.messages = messages;
    if (uploads.length) payload.uploads = uploads;
  }
  return payload;
}

/** Build a Blob (MIME: application/json) carrying the current state. */
export function buildVlxBlob(opts: { name?: string } = {}): Blob {
  const payload = buildVlxPayload(opts);
  const json = JSON.stringify(payload, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/** Sanitise a filename: keep letters, digits, dashes, dots, underscores. */
function safeFilename(name?: string): string {
  const base = (name ?? 'circuit-muse-project').trim() || 'circuit-muse-project';
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 80);
  return `${cleaned || 'circuit-muse-project'}.vlx`;
}

/**
 * Trigger a browser download of the current state as `<name>.vlx`.
 * Returns the filename actually used (for UI feedback).
 */
export function triggerDownloadVlx(opts: { name?: string } = {}): string {
  const blob = buildVlxBlob(opts);
  const filename = safeFilename(opts.name);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // The browser starts the download immediately. Revoke the URL on the
  // next tick so the click handler has time to settle before GC.
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
  return filename;
}

/** Thrown by parseVlxFile when the file isn't a valid .vlx payload. */
export class VlxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VlxParseError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function isKnownBoardKind(kind: unknown): kind is BoardKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(BOARD_KIND_LABELS, kind);
}

/** Group id the simulator store always assigns to a board (see addBoard). */
export function boardFileGroupId(boardId: string): string {
  return `group-${boardId}`;
}

function normaliseFiles(raw: unknown, where: string): Array<{ name: string; content: string }> {
  if (!Array.isArray(raw)) throw new VlxParseError(`File group "${where}" is not a list of files.`);
  return raw.map((f, i) => {
    if (!isPlainObject(f) || typeof f.name !== 'string' || !f.name.trim()) {
      throw new VlxParseError(`File #${i + 1} in group "${where}" has no valid name.`);
    }
    return { name: f.name, content: typeof f.content === 'string' ? f.content : '' };
  });
}

function normaliseEndpoint(raw: unknown, wireIdx: number, side: string): Wire['start'] {
  if (!isPlainObject(raw) || typeof raw.componentId !== 'string') {
    throw new VlxParseError(`Wire #${wireIdx + 1} has an invalid ${side} endpoint.`);
  }
  // Very old saves used `pinId` instead of `pinName`.
  const pin = typeof raw.pinName === 'string' ? raw.pinName : typeof raw.pinId === 'string' ? raw.pinId : '';
  return {
    componentId: raw.componentId,
    pinName: pin,
    x: finiteOr(raw.x, 0),
    y: finiteOr(raw.y, 0),
  };
}

/**
 * Validate and normalise anything that claims to be a project snapshot:
 * a .vlx payload, a legacy "velxio-project" payload, or the raw JSON export
 * (`{ boards, fileGroups, components, wires }` with no format field when
 * `allowMissingFormat` is set). Throws VlxParseError with a readable reason.
 *
 * Keep the checks defensive — users may edit files by hand or feed us a wrong
 * file by accident, and nothing must reach the stores until it passes.
 */
export function normalizeProjectPayload(
  data: unknown,
  opts: { allowMissingFormat?: boolean } = {},
): VlxPayload {
  if (!isPlainObject(data)) {
    throw new VlxParseError('File is not a JSON object.');
  }
  const formatOk =
    data.format === VLX_FORMAT ||
    (typeof data.format === 'string' && LEGACY_VLX_FORMATS.has(data.format)) ||
    (opts.allowMissingFormat && data.format === undefined);
  if (!formatOk) {
    throw new VlxParseError(
      `Not a CircuitMuse project file (expected format="${VLX_FORMAT}", got ${JSON.stringify(
        data.format,
      )}).`,
    );
  }
  let version = VLX_VERSION;
  if (data.format !== undefined) {
    if (typeof data.version !== 'number' || !Number.isFinite(data.version)) {
      throw new VlxParseError('Missing or invalid "version" field.');
    }
    version = data.version;
  }
  if (version > VLX_VERSION) {
    throw new VlxParseError(
      `This file uses .vlx format version ${version}, but this CircuitMuse supports up to v${VLX_VERSION}. Update CircuitMuse to open it.`,
    );
  }
  if (!Array.isArray(data.boards)) {
    throw new VlxParseError('Missing or invalid "boards" array.');
  }
  if (!isPlainObject(data.fileGroups)) {
    throw new VlxParseError('Missing or invalid "fileGroups" object.');
  }
  const rawComponents = data.components ?? [];
  const rawWires = data.wires ?? [];
  if (!Array.isArray(rawComponents)) {
    throw new VlxParseError('Missing or invalid "components" array.');
  }
  if (!Array.isArray(rawWires)) {
    throw new VlxParseError('Missing or invalid "wires" array.');
  }

  // ── Boards ──
  const boardIds = new Set<string>();
  const groupRemap = new Map<string, string>();
  const boards: VlxBoard[] = data.boards.map((b, i) => {
    if (!isPlainObject(b) || typeof b.id !== 'string' || !b.id) {
      throw new VlxParseError(`Board #${i + 1} has no valid "id".`);
    }
    if (!isKnownBoardKind(b.boardKind)) {
      throw new VlxParseError(
        `Board "${b.id}" uses board type ${JSON.stringify(b.boardKind)}, which this CircuitMuse does not support. Update CircuitMuse to open it.`,
      );
    }
    if (boardIds.has(b.id)) throw new VlxParseError(`Two boards share the id "${b.id}".`);
    boardIds.add(b.id);
    // The store always names a board's group `group-<id>`; files saved under
    // any other id would be orphaned, so remap them onto the real group.
    const groupId = boardFileGroupId(b.id);
    if (typeof b.activeFileGroupId === 'string' && b.activeFileGroupId !== groupId) {
      groupRemap.set(b.activeFileGroupId, groupId);
    }
    const board: VlxBoard = {
      id: b.id,
      boardKind: b.boardKind,
      x: finiteOr(b.x, 0),
      y: finiteOr(b.y, 0),
      activeFileGroupId: groupId,
    };
    if (typeof b.name === 'string') board.name = b.name;
    if (b.languageMode === 'arduino' || b.languageMode === 'micropython') {
      board.languageMode = b.languageMode as LanguageMode;
    }
    if (typeof b.serialBaudRate === 'number' && Number.isFinite(b.serialBaudRate)) {
      board.serialBaudRate = b.serialBaudRate;
    }
    if (isPlainObject(b.boardOptions)) board.boardOptions = b.boardOptions as unknown as VlxBoard['boardOptions'];
    if (Array.isArray(b.spiffsFiles)) board.spiffsFiles = b.spiffsFiles as VlxBoard['spiffsFiles'];
    if (Array.isArray(b.libraries)) {
      board.libraries = b.libraries.filter((l): l is string => typeof l === 'string');
    }
    return board;
  });

  // ── File groups ──
  const fileGroups: VlxPayload['fileGroups'] = {};
  for (const [gid, files] of Object.entries(data.fileGroups)) {
    const target = groupRemap.get(gid) ?? gid;
    // Don't let a remapped legacy group overwrite a correctly named one.
    if (fileGroups[target] && target !== gid) continue;
    fileGroups[target] = normaliseFiles(files, gid);
  }
  // Every board needs its group, otherwise the editor has nothing to show.
  for (const b of boards) {
    if (!fileGroups[b.activeFileGroupId]) fileGroups[b.activeFileGroupId] = [];
  }

  // ── Components ──
  const components: Component[] = rawComponents.map((c, i) => {
    if (!isPlainObject(c) || typeof c.id !== 'string' || !c.id) {
      throw new VlxParseError(`Component #${i + 1} has no valid "id".`);
    }
    if (typeof c.metadataId !== 'string' || !c.metadataId) {
      throw new VlxParseError(`Component "${c.id}" has no valid "metadataId".`);
    }
    // Older saves used Wokwi field names (left/top/attrs/rotate).
    const properties: Record<string, unknown> = isPlainObject(c.properties)
      ? { ...c.properties }
      : isPlainObject(c.attrs)
        ? { ...c.attrs }
        : {};
    if (properties.rotation === undefined && typeof c.rotate === 'number') properties.rotation = c.rotate;
    return {
      ...c,
      id: c.id,
      metadataId: c.metadataId,
      x: finiteOr(c.x ?? c.left, 0),
      y: finiteOr(c.y ?? c.top, 0),
      properties,
    } as Component;
  });

  // ── Wires ──
  const wireIds = new Set<string>();
  const wires: Wire[] = rawWires.map((w, i) => {
    if (!isPlainObject(w)) throw new VlxParseError(`Wire #${i + 1} is not an object.`);
    let id = typeof w.id === 'string' && w.id ? w.id : `wire-import-${i}`;
    while (wireIds.has(id)) id = `${id}-dup`;
    wireIds.add(id);
    const waypoints = Array.isArray(w.waypoints)
      ? w.waypoints
          .filter((p): p is Record<string, unknown> => isPlainObject(p))
          .map((p) => ({ x: finiteOr(p.x, NaN), y: finiteOr(p.y, NaN) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      : [];
    const wire: Wire = {
      ...(w as unknown as Wire),
      id,
      start: normaliseEndpoint(w.start, i, 'start'),
      end: normaliseEndpoint(w.end, i, 'end'),
      waypoints,
      color: typeof w.color === 'string' && w.color ? w.color : '#22c55e',
    };
    return wire;
  });

  const activeBoardId =
    typeof data.activeBoardId === 'string' && boardIds.has(data.activeBoardId)
      ? data.activeBoardId
      : (boards[0]?.id ?? null);

  const payload: VlxPayload = {
    format: VLX_FORMAT,
    version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
    boards,
    fileGroups,
    components,
    wires,
    activeBoardId,
  };
  if (typeof data.name === 'string') payload.name = data.name;
  if (Array.isArray(data.messages)) {
    payload.messages = data.messages.filter(
      (m): m is Message =>
        isPlainObject(m) && typeof m.role === 'string' && typeof m.content === 'string',
    );
  }
  if (Array.isArray(data.uploads)) {
    payload.uploads = data.uploads.filter(
      (u): u is UploadedFile => isPlainObject(u) && typeof u.id === 'string' && typeof u.name === 'string',
    );
  }
  return payload;
}

/** Parse JSON text into a validated payload. Throws VlxParseError. */
export function parseVlxText(text: string, opts: { allowMissingFormat?: boolean } = {}): VlxPayload {
  // Strip a UTF-8 BOM some editors add when the user hand-edits the file.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!clean.trim()) throw new VlxParseError('The file is empty.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (err) {
    throw new VlxParseError(`Invalid JSON: ${(err as Error).message}`);
  }
  return normalizeProjectPayload(parsed, opts);
}

/**
 * Read a File object (from a `<input type="file">` change event or a
 * drop), parse it as JSON, validate, and return the payload. Throws
 * VlxParseError on any failure.
 */
export async function parseVlxFile(
  file: File,
  opts: { allowMissingFormat?: boolean } = {},
): Promise<VlxPayload> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new VlxParseError(`Could not read file: ${(err as Error).message}`);
  }
  return parseVlxText(text, opts);
}

/**
 * Replace the whole workspace with a validated payload. If anything throws
 * half-way, the previous workspace is restored so a bad file never leaves
 * the user with a wiped or half-loaded project.
 */
export function applyProjectPayload(payload: VlxPayload): void {
  const before = buildVlxPayload();
  const chatBefore = {
    messages: useAgentStore.getState().messages,
    uploads: useUploadsStore.getState().files,
  };
  try {
    loadPayloadIntoStores(payload);
  } catch (err) {
    try {
      loadPayloadIntoStores(before);
      useAgentStore.getState().setMessages(chatBefore.messages);
      useUploadsStore.getState().setFiles(chatBefore.uploads);
    } catch (restoreErr) {
      console.error('[import] could not restore the previous workspace', restoreErr);
    }
    throw new VlxParseError(`Could not load the project: ${(err as Error).message}`);
  }
}

function loadPayloadIntoStores(payload: VlxPayload): void {
  useSimulatorStore.getState().loadProjectState({
    boards: payload.boards as unknown as BoardInstance[],
    fileGroups: payload.fileGroups,
    components: payload.components,
    wires: payload.wires,
    activeBoardId: payload.activeBoardId,
  });
  // Chat history only travels with files that carry it; older files keep
  // whatever is in the panel rather than silently wiping it.
  if (payload.messages) useAgentStore.getState().setMessages(payload.messages);
  if (payload.uploads) useUploadsStore.getState().setFiles(payload.uploads);
}

/**
 * Convenience wrapper: parse the file AND load its contents into the
 * stores. Returns the parsed payload so the caller can show a toast.
 */
export async function importVlxFile(file: File): Promise<VlxPayload> {
  const payload = await parseVlxFile(file);
  applyProjectPayload(payload);
  return payload;
}
