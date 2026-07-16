/**
 * connectChipInputsToSolve — feed solved net voltages back into custom-chip
 * INPUT pins, so a chip can read buttons / switches / sensors with no board.
 *
 * A custom chip already drives its OUTPUT pins into the netlist (chipPinDrives
 * -> SPICE voltage sources -> LEDs light). The INPUT direction was missing: a
 * chip pin wired to a pushbutton / switch / sensor had its net solved by
 * ngspice, but NOTHING wrote that net's state back to the PinManager key the
 * chip reads via `vx_pin_read`. So a chip could light LEDs board-less but never
 * read an input without an Arduino driving the pin.
 *
 * After every solve we look up each wired chip pin's net voltage, threshold it
 * to HIGH/LOW, and `triggerPinChange()` the chip's synthetic pin — which both
 * updates `getPinState` (polling reads) and fires the chip's `onPinChange` edge
 * handlers. Pins the chip is actively DRIVING are skipped so we never fight its
 * own outputs. This is the input counterpart of the chip-output SPICE path and
 * is solver-agnostic — it reads only the electrical store shape.
 */
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useElectricalStore } from '../../store/useElectricalStore';
import { syntheticChipPin } from '../customChips/syntheticPins';
import { getChipDrivenPins } from '../customChips/chipPinDrives';

// 5V-logic thresholds with a hysteresis band so a node hovering near the
// midpoint doesn't chatter HIGH/LOW every solve. Digital inputs (a button to
// VCC with a pull-down) swing fully, so the band is rarely entered.
const V_HIGH = 3.0;
const V_LOW = 2.0;

/** Pin names declared by a chip.json (entries may be strings or {name,...}). */
function chipPinNames(chipJsonStr: string): string[] {
  try {
    const obj = JSON.parse(chipJsonStr);
    if (Array.isArray(obj.pins)) {
      return obj.pins
        .map((p: unknown) =>
          typeof p === 'string' ? p : String((p as { name?: string } | null)?.name ?? ''),
        )
        .filter(Boolean);
    }
  } catch {
    /* malformed chip.json — no readable pins */
  }
  return [];
}

export function connectChipInputsToSolve(): () => void {
  // Last logic level written per synthetic pin, so we only emit real edges
  // (and so the hysteresis band can hold the previous level).
  const lastState = new Map<number, boolean>();

  function writeChipInputs() {
    const { nodeVoltages, pinNetMap } = useElectricalStore.getState();
    const sim = useSimulatorStore.getState();
    const pinManager = sim.pinManager;
    if (!pinManager) return;

    for (const comp of sim.components) {
      if (comp.metadataId !== 'custom-chip') continue;
      const props = comp.properties as Record<string, unknown>;
      const names = chipPinNames(String(props.chipJson ?? '{}'));
      if (names.length === 0) continue;
      // Pins the chip is currently driving as outputs — never overwrite those.
      const driven = new Set(getChipDrivenPins(comp.id).map((d) => d.pin));

      for (const pinName of names) {
        if (driven.has(pinName)) continue;
        const net = pinNetMap.get(`${comp.id}:${pinName}`);
        if (!net) continue;
        const v = nodeVoltages[net];
        if (v == null) continue;

        const synth = syntheticChipPin(comp.id, pinName);
        const prev = lastState.get(synth);
        let next: boolean;
        if (v >= V_HIGH) next = true;
        else if (v <= V_LOW) next = false;
        else next = prev ?? false; // inside the hysteresis band — hold
        if (prev === next) continue;
        lastState.set(synth, next);
        pinManager.triggerPinChange(synth, next);
      }
    }
  }

  const unsub = useElectricalStore.subscribe((state, prev) => {
    if (state.nodeVoltages !== prev.nodeVoltages) writeChipInputs();
  });
  // Initial pass for examples that pre-populate the store before mount.
  writeChipInputs();
  return () => unsub();
}
