/**
 * Regression test for the multi-servo blink bug (user report,
 * project 5218f9e3-136d-43b3-bba1-6cebde21e1a4).
 *
 * Background: a solar-tracker project with TWO ESP32 servos on
 * GPIO 13 and 12, driven by LEDC channels 0 and 1 respectively.
 * The user observed both servos snapping between two positions
 * (mirroring each other) instead of moving independently.
 *
 * Root cause: the legacy `ledc_update` event carried an embedded
 * `gpio` value that the backend's gpio_out_sel poll wasn't always
 * able to resolve before emission; on `gpio=-1` the frontend fell
 * back to `PinManager.broadcastPwm` which fanned the duty out to
 * EVERY registered PWM listener, making both servos mirror.
 *
 * This test exercises the canonical SignalRouter path end-to-end:
 *   1. SignalRouter is fed two `gpio_routing` events (one per servo)
 *   2. Two `ledc_duty` events fire (one per channel, different duties)
 *   3. Each pin receives ONLY its own channel's duty
 *
 * If `PinManager.broadcastPwm` ever creeps back into the LEDC code
 * path, this test fails because pin 12 would observe pin 13's duty.
 */

import { describe, it, expect } from 'vitest';
import { PinManager } from '../simulation/PinManager';
import { SignalRouter } from '../simulation/SignalRouter';
import { ledcSignalForChannel } from '../simulation/esp32-signals';

/**
 * Mini factory that replicates the wiring `useSimulatorStore` does:
 * per-board PinManager + SignalRouter + the three handlers
 * (gpio_routing, gpio_routing_clear, ledc_duty).  We don't import
 * the store directly because it's tied to Zustand + global state;
 * this is the pure functional core.
 */
function setupBoard() {
  const pm = new PinManager();
  const router = new SignalRouter();

  const ledcDuty = (duty: { channel: number; duty_pct: number }) => {
    const dutyCycle = duty.duty_pct / 100;
    const sig = ledcSignalForChannel(duty.channel);
    for (const pin of router.pinsForSignal(sig)) {
      pm.updatePwm(pin, dutyCycle);
    }
  };
  const gpioRouting = (routing: { gpio: number; signal_id: number }) => {
    router.updateRouting(routing.gpio, routing.signal_id);
  };
  const gpioRoutingClear = (gpio: number) => {
    router.clearRouting(gpio);
  };

  return { pm, router, ledcDuty, gpioRouting, gpioRoutingClear };
}

describe('multi-servo via SignalRouter — solar-tracker regression', () => {
  it('two servos on different LEDC channels move independently', () => {
    const { pm, ledcDuty, gpioRouting } = setupBoard();

    // Capture duties seen per pin via onPwmChange listeners — exactly
    // what the real `servo` PartSimulator registers in production.
    const panDuties: number[] = [];
    const tiltDuties: number[] = [];
    pm.onPwmChange(13, (_pin, duty) => panDuties.push(duty));
    pm.onPwmChange(12, (_pin, duty) => tiltDuties.push(duty));

    // Backend's worker observes the firmware's ledcAttachPin calls
    // and emits two gpio_routing events — one per servo channel.
    gpioRouting({ gpio: 13, signal_id: ledcSignalForChannel(0) }); // servoPan
    gpioRouting({ gpio: 12, signal_id: ledcSignalForChannel(1) }); // servoTilt

    // Servo.write(0) → ledc duty 2.72% (~544 µs pulse, 0°)
    // Servo.write(180) → ledc duty 12.0% (~2400 µs pulse, 180°)
    ledcDuty({ channel: 0, duty_pct: 7.5 });   // servoPan → ~90°
    ledcDuty({ channel: 1, duty_pct: 2.72 });  // servoTilt → 0°
    ledcDuty({ channel: 0, duty_pct: 8.0 });   // servoPan → ~95°
    ledcDuty({ channel: 1, duty_pct: 3.0 });   // servoTilt → ~3°

    // Pan saw ONLY pan duties; tilt saw ONLY tilt duties.
    // Use toBeCloseTo because dividing a 2-decimal percentage by 100
    // doesn't produce exact binary floats (0.0272 ≠ 2.72/100).
    expect(panDuties).toHaveLength(2);
    expect(panDuties[0]).toBeCloseTo(0.075, 10);
    expect(panDuties[1]).toBeCloseTo(0.08, 10);
    expect(tiltDuties).toHaveLength(2);
    expect(tiltDuties[0]).toBeCloseTo(0.0272, 10);
    expect(tiltDuties[1]).toBeCloseTo(0.03, 10);
  });

  it('clearing a routing stops duty updates from reaching the pin', () => {
    const { pm, ledcDuty, gpioRouting, gpioRoutingClear } = setupBoard();
    const duties: number[] = [];
    pm.onPwmChange(13, (_pin, d) => duties.push(d));

    gpioRouting({ gpio: 13, signal_id: ledcSignalForChannel(0) });
    ledcDuty({ channel: 0, duty_pct: 7.5 });
    expect(duties).toEqual([0.075]);

    gpioRoutingClear(13);
    ledcDuty({ channel: 0, duty_pct: 12.0 }); // pin 13 no longer routed
    expect(duties).toEqual([0.075]); // unchanged
  });

  it('multi-pin routing — one channel driving two pins gets both', () => {
    // Rare but legal in real ESP32 hardware: the same LEDC channel
    // routed to two GPIOs via the matrix.  The SignalRouter must
    // dispatch one duty event to BOTH pins (different from the buggy
    // broadcast which dispatched to *all* PWM listeners regardless
    // of routing).
    const { pm, ledcDuty, gpioRouting } = setupBoard();
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    pm.onPwmChange(13, (_p, d) => a.push(d));
    pm.onPwmChange(12, (_p, d) => b.push(d));
    pm.onPwmChange(14, (_p, d) => c.push(d)); // unrelated channel

    const sigCh0 = ledcSignalForChannel(0);
    const sigCh1 = ledcSignalForChannel(1);
    gpioRouting({ gpio: 13, signal_id: sigCh0 });
    gpioRouting({ gpio: 12, signal_id: sigCh0 }); // same channel!
    gpioRouting({ gpio: 14, signal_id: sigCh1 });

    ledcDuty({ channel: 0, duty_pct: 7.5 });

    expect(a).toEqual([0.075]);  // pin 13: ch 0
    expect(b).toEqual([0.075]);  // pin 12: ch 0
    expect(c).toEqual([]);       // pin 14: ch 1, untouched
  });

  it('re-routing a pin between channels carries the next duty correctly', () => {
    const { pm, ledcDuty, gpioRouting } = setupBoard();
    const duties: number[] = [];
    pm.onPwmChange(13, (_p, d) => duties.push(d));

    // Pin 13 initially on channel 0.
    gpioRouting({ gpio: 13, signal_id: ledcSignalForChannel(0) });
    ledcDuty({ channel: 0, duty_pct: 5.0 });
    expect(duties).toEqual([0.05]);

    // Firmware re-attaches pin 13 to channel 1 (legal — Servo.detach
    // then re-attach with a different channel).
    gpioRouting({ gpio: 13, signal_id: ledcSignalForChannel(1) });

    // A duty on the OLD channel must NOT reach pin 13 anymore.
    ledcDuty({ channel: 0, duty_pct: 9.0 });
    expect(duties).toEqual([0.05]); // unchanged

    // A duty on the NEW channel reaches it.
    ledcDuty({ channel: 1, duty_pct: 10.0 });
    expect(duties).toEqual([0.05, 0.1]);
  });

  it('ledc_duty with no routing yet is silently dropped (no broadcast)', () => {
    // The crux of the original bug: if a duty arrives BEFORE the
    // matrix is populated, the legacy path broadcast it to every
    // listener.  The SignalRouter path correctly drops it — the
    // backend's next gpio_routing event will trigger a fresh duty
    // emission anyway, so missing the first frame is invisible.
    const { pm, ledcDuty } = setupBoard();
    const seen: Array<[number, number]> = [];
    pm.onPwmChange(13, (p, d) => seen.push([p, d]));
    pm.onPwmChange(12, (p, d) => seen.push([p, d]));

    // No gpio_routing has happened yet.
    ledcDuty({ channel: 0, duty_pct: 7.5 });
    expect(seen).toEqual([]); // both pins untouched, no broadcast
  });

  it('PinManager exposes no broadcastPwm fallback', () => {
    // The pre-SignalRouter patch shipped a `broadcastPwm` method on
    // PinManager that fanned a duty out to every PWM listener as a
    // gpio=-1 fallback.  The SignalRouter rewrite deletes that method
    // entirely.  This test guards the deletion: if a future refactor
    // adds it back, the regression fails here rather than in
    // production multi-servo wiring.
    const { pm } = setupBoard();
    expect((pm as unknown as { broadcastPwm?: unknown }).broadcastPwm).toBeUndefined();
  });
});
