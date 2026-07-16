/**
 * MotorDriverParts.ts — simulation logic for stepper motor drivers.
 *
 * a4988 — Pololu-style bipolar stepper driver with a STEP/DIR interface.
 *   The MCU pulses STEP (one rising edge = one step) and sets DIR for the
 *   direction; MS1/MS2/MS3 select microstepping. The driver's coil outputs
 *   (1A/1B = coil A, 2A/2B = coil B) wire to a bipolar stepper's A+/A-/B+/B-.
 *
 *   We model the driver, not the coil waveform: on each STEP rising edge we
 *   rotate the connected wokwi-stepper-motor (or wokwi-biaxial-stepper) by one
 *   (micro)step in the DIR direction. This matches how real STEP/DIR drivers
 *   behave and how AccelStepper / the Stepper library drive them.
 */

import { PartSimulationRegistry } from './PartSimulationRegistry';
import { useSimulatorStore } from '../../store/useSimulatorStore';

/** Find the DOM element wired to `componentId`'s `pinName`, or null. */
function getConnectedElement(componentId: string, pinName: string): HTMLElement | null {
  const { wires } = useSimulatorStore.getState();
  for (const wire of wires) {
    let otherId: string | null = null;
    if (wire.start.componentId === componentId && wire.start.pinName === pinName) {
      otherId = wire.end.componentId;
    } else if (wire.end.componentId === componentId && wire.end.pinName === pinName) {
      otherId = wire.start.componentId;
    }
    if (otherId) {
      const el = document.getElementById(otherId);
      if (el) return el;
    }
  }
  return null;
}

const STEPPER_TAGS = ['wokwi-stepper-motor', 'wokwi-biaxial-stepper'];
const FULL_STEP_DEG = 1.8;

PartSimulationRegistry.register('a4988', {
  attachEvents: (element, simulator, getArduinoPinHelper, componentId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pinManager = (simulator as any).pinManager;
    if (!pinManager) return () => {};

    const pinSTEP = getArduinoPinHelper('STEP');
    const pinDIR = getArduinoPinHelper('DIR');
    const pinEN = getArduinoPinHelper('ENABLE');
    const pinMS1 = getArduinoPinHelper('MS1');
    const pinMS2 = getArduinoPinHelper('MS2');
    const pinMS3 = getArduinoPinHelper('MS3');

    // Locate the stepper wired to any coil output.
    function findMotor(): (HTMLElement & { angle?: number }) | null {
      for (const out of ['1A', '1B', '2A', '2B']) {
        const el = getConnectedElement(componentId, out);
        if (el && STEPPER_TAGS.includes(el.tagName.toLowerCase())) {
          return el as HTMLElement & { angle?: number };
        }
      }
      return null;
    }
    const motor = findMotor();

    let dirHigh = false;
    let enabled = true; // EN is active-LOW; unconnected = enabled (tied to GND)
    let ms1 = false;
    let ms2 = false;
    let ms3 = false;
    let prevStep = false;
    let cumAngle = motor ? Number(motor.angle) || 0 : 0;

    function microFactor(): number {
      // MS3 MS2 MS1 -> full/half/quarter/eighth/sixteenth (A4988 truth table).
      const code = (ms3 ? 4 : 0) | (ms2 ? 2 : 0) | (ms1 ? 1 : 0);
      switch (code) {
        case 1: return 2; // half
        case 2: return 4; // quarter
        case 3: return 8; // eighth
        case 7: return 16; // sixteenth
        default: return 1; // full
      }
    }

    const unsubs: (() => void)[] = [];
    const sub = (pin: number | null, cb: (s: boolean) => void) => {
      if (pin !== null) {
        unsubs.push(pinManager.onPinChange(pin, (_: number, s: boolean) => cb(s)));
      }
    };

    sub(pinDIR, (s) => (dirHigh = s));
    sub(pinEN, (s) => (enabled = !s)); // active-low
    sub(pinMS1, (s) => (ms1 = s));
    sub(pinMS2, (s) => (ms2 = s));
    sub(pinMS3, (s) => (ms3 = s));

    if (pinSTEP !== null) {
      unsubs.push(
        pinManager.onPinChange(pinSTEP, (_: number, s: boolean) => {
          if (s && !prevStep && enabled && motor) {
            const stepAngle = FULL_STEP_DEG / microFactor();
            cumAngle += dirHigh ? stepAngle : -stepAngle;
            motor.angle = ((cumAngle % 360) + 360) % 360;
          }
          prevStep = s;
        }),
      );
    }

    return () => unsubs.forEach((u) => u());
  },
});
