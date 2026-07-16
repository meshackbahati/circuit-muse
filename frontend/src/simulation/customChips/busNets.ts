/**
 * Multi-driver bus net registry — Phase 1 of the multi-chip digital bus track
 * (project/multichip-bus/). Sits between the chip runtime and the PinManager
 * for chip-to-chip BUS net keys (syntheticNetPin) only.
 *
 * Phase 0 gave every endpoint of a chip-to-chip net one shared PinManager key,
 * but PinManager is last-writer-wins — wrong for a bus where several chips can
 * drive one data line and the rest release it (Hi-Z). This registry tracks each
 * chip pin's (value, strength) contribution per net, resolves the net with the
 * 4-valued rules (busLogic.resolveNet), and pushes the RESOLVED level into the
 * PinManager so readers see the bus, not the last writer. Contention (two strong
 * drivers disagree -> X) is surfaced as a console warning, like Proteus.
 *
 * Only BUS net keys flow through here; board pins and single-chip-to-component
 * synthetic pins keep the legacy direct PinManager path untouched.
 */
import { resolveNet, resolvedToBool, type Drive } from './busLogic';
import { publishNetLevel, resetBusKernel } from './busKernel';

interface PinManagerLike {
  triggerPinChange(pin: number, state: boolean, source?: 'mcu' | 'external'): void;
}

// netKey -> (driverId -> Drive). driverId = `${componentId}::${pinName}`.
const nets = new Map<number, Map<string, Drive>>();
// Nets currently flagged as in contention — so we warn once per onset, not per
// re-resolve, and clear when the contention is gone.
const inContention = new Set<number>();

function recompute(pm: PinManagerLike, netKey: number): void {
  const drivers = nets.get(netKey);
  const resolved = resolveNet(drivers ? drivers.values() : []);

  if (resolved.v === 'X') {
    if (!inContention.has(netKey)) {
      inContention.add(netKey);
      console.warn(
        `[chipbus] bus contention on net ${netKey}: two strong drivers disagree (resolved X)`,
      );
    }
  } else {
    inContention.delete(netKey);
  }

  // PinManager is boolean; push the projected level (only a driven 1 is high)
  // through the settle kernel so the change propagates as a bounded delta-cycle
  // pass rather than a recursive cascade.
  publishNetLevel(pm, netKey, resolvedToBool(resolved));
}

/** Set (or replace) one chip pin's contribution to a bus net and re-resolve. */
export function setBusDrive(
  pm: PinManagerLike,
  netKey: number,
  driverId: string,
  drive: Drive,
): void {
  let m = nets.get(netKey);
  if (!m) {
    m = new Map();
    nets.set(netKey, m);
  }
  m.set(driverId, drive);
  recompute(pm, netKey);
}

/** Remove every driver a chip contributes (on dispose) and re-resolve its nets. */
export function clearBusDriversForChip(pm: PinManagerLike, componentId: string): void {
  const prefix = `${componentId}::`;
  for (const [netKey, m] of nets) {
    let changed = false;
    for (const id of [...m.keys()]) {
      if (id.startsWith(prefix)) {
        m.delete(id);
        changed = true;
      }
    }
    if (changed) recompute(pm, netKey);
  }
}

/** Test seam: wipe all bus-net driver state (and the settle kernel). */
export function resetBusNets(): void {
  nets.clear();
  inContention.clear();
  resetBusKernel();
}
