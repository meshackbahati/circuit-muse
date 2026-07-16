/**
 * PinManager — JS port of Velxio's frontend/src/simulation/PinManager.ts
 *
 * Kept 1:1 with Velxio so chips written here behave identically when ported.
 * Maps Arduino pin numbers to subscribers; supports digital, PWM, and analog.
 */

export class PinManager {
  constructor() {
    this.listeners = new Map();        // pin → Set<cb>
    this.pwmListeners = new Map();
    this.analogListeners = new Map();
    this.pinStates = new Map();
    this.pwmValues = new Map();
  }

  // ── Digital ────────────────────────────────────────────────────────────

  onPinChange(pin, cb) {
    if (!this.listeners.has(pin)) this.listeners.set(pin, new Set());
    this.listeners.get(pin).add(cb);
    return () => this.listeners.get(pin)?.delete(cb);
  }

  /** Bit-level port update — mirrors AVR PORT register semantics. */
  updatePort(portName, newValue, oldValue = 0, pinMap) {
    const legacyOffsets = { PORTB: 8, PORTC: 14, PORTD: 0 };
    for (let bit = 0; bit < 8; bit++) {
      const mask = 1 << bit;
      const oldS = (oldValue & mask) !== 0;
      const newS = (newValue & mask) !== 0;
      if (oldS === newS) continue;
      const pin = pinMap ? pinMap[bit] : (legacyOffsets[portName] ?? 0) + bit;
      if (pin < 0) continue;
      this.pinStates.set(pin, newS);
      const cbs = this.listeners.get(pin);
      if (cbs) cbs.forEach((c) => c(pin, newS));
    }
  }

  getPinState(pin) {
    return this.pinStates.get(pin) || false;
  }

  setPinState(pin, state) {
    this.triggerPinChange(pin, state);
  }

  triggerPinChange(pin, state) {
    if (this.pinStates.get(pin) === state) return;
    this.pinStates.set(pin, state);
    const cbs = this.listeners.get(pin);
    if (cbs) cbs.forEach((c) => c(pin, state));
  }

  resetPinStates() {
    this.pinStates.clear();
  }

  // ── PWM ────────────────────────────────────────────────────────────────

  onPwmChange(pin, cb) {
    if (!this.pwmListeners.has(pin)) this.pwmListeners.set(pin, new Set());
    this.pwmListeners.get(pin).add(cb);
    return () => this.pwmListeners.get(pin)?.delete(cb);
  }

  updatePwm(pin, dutyCycle) {
    this.pwmValues.set(pin, dutyCycle);
    const cbs = this.pwmListeners.get(pin);
    if (cbs) cbs.forEach((c) => c(pin, dutyCycle));
  }

  getPwmValue(pin) {
    return this.pwmValues.get(pin) ?? 0;
  }

  // ── Analog ─────────────────────────────────────────────────────────────

  onAnalogChange(pin, cb) {
    if (!this.analogListeners.has(pin)) this.analogListeners.set(pin, new Set());
    this.analogListeners.get(pin).add(cb);
    return () => this.analogListeners.get(pin)?.delete(cb);
  }

  setAnalogVoltage(pin, voltage) {
    const cbs = this.analogListeners.get(pin);
    if (cbs) cbs.forEach((c) => c(pin, voltage));
  }

  // ── Utility ────────────────────────────────────────────────────────────

  clearAllListeners() {
    this.listeners.clear();
    this.pwmListeners.clear();
    this.analogListeners.clear();
  }
}
