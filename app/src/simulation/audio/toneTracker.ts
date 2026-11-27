/**
 * Decides what a buzzer should sound like from its pin activity.
 *
 * - Toggling in the audio range (tone(), a bit-banged square wave): the pitch
 *   is measured from the time between rising edges in simulated time, so it
 *   is right even when the simulation runs slower than real time.
 * - Held HIGH (digitalWrite): a steady beep, like the active buzzers most kits
 *   ship. Slow toggling (a beep every half second) follows the pin.
 * - PWM from hardware timers (analogWrite) has no edges, only a duty cycle, so
 *   it plays at the usual Arduino PWM rate.
 * - LOW or idle: silent.
 */

export const ACTIVE_BUZZER_HZ = 2300;
export const PWM_DEFAULT_HZ = 490;
/** Rising edges further apart than this (simulated ms) are beeps, not a tone. */
const MAX_TONE_PERIOD_MS = 50; // 20 Hz
const MIN_TONE_PERIOD_MS = 0.05; // 20 kHz
/** Wall-clock time without edges after which a tone has stopped. */
const TONE_IDLE_MS = 120;

export type ToneDecision = { kind: 'silent' } | { kind: 'tone'; frequency: number };

export class ToneTracker {
  private level = false;
  private lastRiseSim: number | null = null;
  private periods: number[] = [];
  private lastToneEdgeWall = -Infinity;
  private pwmDuty = 0;

  /** A pin change with its simulated timestamp and the wall-clock time. */
  edge(state: boolean, simMs: number, wallMs: number): void {
    if (state && !this.level) {
      if (this.lastRiseSim !== null) {
        const period = simMs - this.lastRiseSim;
        if (period >= MIN_TONE_PERIOD_MS && period <= MAX_TONE_PERIOD_MS) {
          this.periods.push(period);
          if (this.periods.length > 4) this.periods.shift();
          this.lastToneEdgeWall = wallMs;
        } else {
          this.periods = [];
        }
      }
      this.lastRiseSim = simMs;
    } else if (!state && this.level && this.periods.length > 0) {
      this.lastToneEdgeWall = wallMs;
    }
    this.level = state;
  }

  /** Level change without a usable timestamp (boards without timed events). */
  setLevel(state: boolean): void {
    this.level = state;
  }

  setPwmDuty(duty: number): void {
    this.pwmDuty = duty;
  }

  decide(wallMs: number): ToneDecision {
    if (this.periods.length > 0 && wallMs - this.lastToneEdgeWall <= TONE_IDLE_MS) {
      const sorted = [...this.periods].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      return { kind: 'tone', frequency: 1000 / median };
    }
    if (this.periods.length > 0) this.periods = [];
    if (this.pwmDuty > 0 && this.pwmDuty < 1) return { kind: 'tone', frequency: PWM_DEFAULT_HZ };
    if (this.level || this.pwmDuty >= 1) return { kind: 'tone', frequency: ACTIVE_BUZZER_HZ };
    return { kind: 'silent' };
  }
}
