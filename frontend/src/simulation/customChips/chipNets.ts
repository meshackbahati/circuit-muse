/**
 * Chip-to-chip net identity — Phase 0 of the multi-chip digital bus track
 * (see project/multichip-bus/ in the velxio-prod repo).
 *
 * THE PROBLEM (root cause A, 00-problem-analysis.md section 2): a digital net
 * is keyed by ONE integer pin number in the per-board PinManager. A board pin
 * (Uno D7 = 7) is net-symmetric — everyone on the net shares the number. But a
 * chip-to-chip net is keyed per-endpoint by `syntheticChipPin(chipId, pinName)`,
 * so the two chips on one wire resolve to two DIFFERENT keys and never share a
 * net. Each chip writes into a key the other never reads.
 *
 * THE FIX: assign every electrically-connected net a single canonical id via
 * union-find over the wire graph, and mint ONE shared `syntheticNetPin(netId)`
 * for any net that has two or more chip endpoints and no board pin. Every
 * endpoint on that net resolves to the same key, so a write on one chip is
 * visible to another through the existing synchronous PinManager fan-out.
 *
 * SCOPE (D-006, never-clone boundary): this module ONLY decides the shared key
 * for pure chip-to-chip nets. It returns null for:
 *   - nets with a board pin  -> traceDetailed's rule 1 (board priority) handles it
 *   - nets with <2 chip endpoints -> traceDetailed's rules 2/3 (single-chip own
 *     synthetic) handle the chip-to-component case unchanged
 * Board emulation never enters this path; the regression surface is the
 * existing chip-to-component examples, gated behind the `chipbus` flag (D-007).
 */
import { UnionFind } from '../spice/unionFind';
import { isBoardComponent, boardPinToNumber } from '../../utils/boardPinMapping';
import { syntheticNetPin } from './syntheticPins';

// Structural view of the slice of simulator state this module needs. The real
// useSimulatorStore state is a superset, so it satisfies this shape directly —
// declaring it structurally keeps the module pure and unit-testable without
// pulling in React / the Zustand store.
interface NetEndpointRef {
  componentId: string;
  pinName: string;
}
interface WireLike {
  start: NetEndpointRef;
  end: NetEndpointRef;
}
interface ComponentLike {
  id: string;
  metadataId: string;
}
interface BoardLike {
  id: string;
  boardKind: string;
}
export interface ChipNetState {
  wires: readonly WireLike[];
  components: readonly ComponentLike[];
  boards: readonly BoardLike[];
}

// Endpoint key = `${componentId}::${pinName}`. velxio chip ids
// (`custom_chip_<ts>_<rand>`) and chip.json pin names are identifier-like and
// never contain `::`, so the split back to (componentId, pinName) is exact.
const SEP = '::';
function epKey(componentId: string, pinName: string): string {
  return `${componentId}${SEP}${pinName}`;
}
function parseEpKey(key: string): { componentId: string; pinName: string } {
  const i = key.indexOf(SEP);
  return { componentId: key.slice(0, i), pinName: key.slice(i + SEP.length) };
}

interface NetInfo {
  /** Lexicographically-smallest endpoint key in the net — stable canonical id
   *  independent of union order, so the minted net pin number does not churn
   *  between resolve passes. */
  canonical: string;
  /** True if any endpoint on the net is a board pin that resolves to a real
   *  GPIO number (board priority defers to traceDetailed's rule 1). */
  hasBoardPin: boolean;
  /** Distinct custom-chip endpoint keys on the net. */
  chipEndpoints: Set<string>;
}

interface ChipNetIndex {
  /** Net representative for an endpoint key, or undefined if not on any wire. */
  rootOf(key: string): string | undefined;
  nets: Map<string, NetInfo>;
}

// ── Feature flag (D-007) ─────────────────────────────────────────────────────
//
// Off by default. Enable with `?chipbus=on` or
// `localStorage.velxio.chipbus = 'on'`, mirroring sim-mixedmode's `?mixedmode`.
// Guards every browser global so the module is safe under vitest/node.

let testOverride: boolean | null = null;
/** Test seam: force the flag on/off, or pass null to restore real detection. */
export function setChipBusEnabledForTest(v: boolean | null): void {
  testOverride = v;
}

export function chipBusEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  try {
    if (typeof window !== 'undefined' && window.location) {
      const q = new URLSearchParams(window.location.search).get('chipbus');
      if (q === 'on' || q === '1' || q === 'true') return true;
      if (q === 'off' || q === '0' || q === 'false') return false;
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('velxio.chipbus');
      if (v === 'on' || v === '1' || v === 'true') return true;
      if (v === 'off' || v === '0' || v === 'false') return false;
    }
  } catch {
    /* SecurityError on localStorage, missing globals in tests — fall through */
  }
  // On by default: chip-to-chip buses are a core capability now. Single-chip and
  // board nets are unaffected (they never take this path), so the only thing
  // this enables is multi-chip buses, which were simply broken before. Override
  // with ?chipbus=off or localStorage.velxio.chipbus = 'off'.
  return true;
}

// ── Net index (memoized by wire/component fingerprint) ───────────────────────

let cache: { sig: string; index: ChipNetIndex } | null = null;

function fingerprint(state: ChipNetState): string {
  const w = state.wires
    .map(
      (x) =>
        `${x.start.componentId}${SEP}${x.start.pinName}|${x.end.componentId}${SEP}${x.end.pinName}`,
    )
    .join(',');
  const c = state.components.map((x) => `${x.id}:${x.metadataId}`).join(',');
  const b = state.boards.map((x) => `${x.id}:${x.boardKind}`).join(',');
  return `${w}#${c}#${b}`;
}

function buildIndex(state: ChipNetState): ChipNetIndex {
  const uf = new UnionFind();
  for (const wire of state.wires) {
    const a = epKey(wire.start.componentId, wire.start.pinName);
    const b = epKey(wire.end.componentId, wire.end.pinName);
    uf.union(a, b);
  }

  const compById = new Map(state.components.map((c) => [c.id, c]));
  const boardById = new Map(state.boards.map((b) => [b.id, b]));
  const nets = new Map<string, NetInfo>();

  for (const [key, root] of uf.entries()) {
    let info = nets.get(root);
    if (!info) {
      info = { canonical: key, hasBoardPin: false, chipEndpoints: new Set() };
      nets.set(root, info);
    }
    if (key < info.canonical) info.canonical = key;

    const { componentId, pinName } = parseEpKey(key);
    const board = boardById.get(componentId);
    if (board || isBoardComponent(componentId)) {
      const kind = board?.boardKind ?? componentId;
      // A real numbered board pin (including -1 power/GND) means a board owns
      // this net; defer to traceDetailed's board-priority rule.
      if (boardPinToNumber(kind, pinName) !== null) info.hasBoardPin = true;
    } else if (compById.get(componentId)?.metadataId === 'custom-chip') {
      info.chipEndpoints.add(key);
    }
  }

  return {
    rootOf: (k) => (uf.has(k) ? uf.find(k) : undefined),
    nets,
  };
}

function getChipNetIndex(state: ChipNetState): ChipNetIndex {
  const sig = fingerprint(state);
  if (cache && cache.sig === sig) return cache.index;
  const index = buildIndex(state);
  cache = { sig, index };
  return index;
}

/** Test seam: drop the memoized index (the fingerprint already invalidates it
 *  on real input changes; this is only for deterministic unit tests). */
export function resetChipNetIndexForTest(): void {
  cache = null;
}

// ── Public resolver ──────────────────────────────────────────────────────────

/**
 * Shared net-canonical key for a chip pin on a pure chip-to-chip net, or null
 * when the legacy resolver rules should handle it (flag off; board on the net;
 * fewer than two chip endpoints). When non-null, EVERY endpoint of the same net
 * gets the identical key, so writes and reads land on one PinManager slot.
 */
export function resolveChipNetKey(
  state: ChipNetState,
  componentId: string,
  pinName: string,
): number | null {
  if (!chipBusEnabled()) return null;
  const idx = getChipNetIndex(state);
  const root = idx.rootOf(epKey(componentId, pinName));
  if (root === undefined) return null;
  const info = idx.nets.get(root);
  if (!info || info.hasBoardPin || info.chipEndpoints.size < 2) return null;
  return syntheticNetPin(info.canonical);
}
