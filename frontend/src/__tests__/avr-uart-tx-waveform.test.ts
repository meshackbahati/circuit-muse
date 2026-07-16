/**
 * AVR UART TX pin waveform synthesis
 *
 * avr8js's USART peripheral only intercepts the transmitted byte at the
 * UDR0 data register — it never toggles PD1 (Uno/Nano) / PE1 (Mega).  The
 * oscilloscope and any other GPIO consumer therefore see a flat line on
 * the TX pin during Serial.print, which doesn't match real hardware.
 *
 * AVRSimulator.emitUartTxFrame() is the shim that closes that gap: when
 * onByteTransmit fires it derives the 10-bit UART frame from the byte and
 * the current USART config, then emits each bit transition through
 * onPinChangeWithTime so the scope sees the same waveform a real ATmega328P
 * would put on PD1.
 *
 * These tests assert that:
 *   - The TX pin is seeded HIGH (idle) when TXEN flips on.
 *   - Each byte produces a properly-timed start/data(LSB-first)/stop sequence
 *     on pin 1 at the configured baud rate.
 *   - Bytes that need no internal transitions (e.g. 0xFF) still emit the
 *     start-bit drop and the stop-bit rise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AVRSimulator } from '../simulation/AVRSimulator';
import { PinManager } from '../simulation/PinManager';

// ATmega328P USART0 register addresses
const UCSRA = 0xc0;
const UCSRB = 0xc1;
const UCSRC = 0xc2;
const UBRRL = 0xc4;
const UBRRH = 0xc5;

const UCSRB_RXEN = 0x10;
const UCSRB_TXEN = 0x08;
const UCSRC_UCSZ1 = 0x04;
const UCSRC_UCSZ0 = 0x02;

const EMPTY_HEX = ':00000001FF\n';

type PinEvent = { pin: number; state: boolean; timeMs: number };

function configureUsartFor115200(sim: AVRSimulator): void {
  const cpu = (sim as unknown as { cpu: { data: Uint8Array } }).cpu;
  cpu.data[UBRRH] = 0;
  cpu.data[UBRRL] = 8; // 16M / (16*9) = 111111 baud (Arduino's actual 115200 setting)
  cpu.data[UCSRC] = UCSRC_UCSZ1 | UCSRC_UCSZ0; // 8 data bits, no parity, 1 stop bit
  cpu.data[UCSRA] = 0; // U2X=0 → multiplier 16
  // Trigger the configuration-change hook by simulating a UCSRB write
  cpu.data[UCSRB] = UCSRB_RXEN | UCSRB_TXEN;
  // avr8js's writeHook for UCSRB updates internal state; the cleanest way to
  // trigger it without running the firmware is to call onConfigurationChange
  // directly (it's the callback we registered, so it's safe to invoke).
  sim.usart!.onConfigurationChange?.();
}

beforeEach(() => {
  let counter = 0;
  let depth = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (depth === 0) {
      depth++;
      cb(0);
      depth--;
    }
    return ++counter;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('AVR USART → TX pin waveform synthesis', () => {
  let pm: PinManager;
  let sim: AVRSimulator;
  let events: PinEvent[];

  beforeEach(() => {
    pm = new PinManager();
    sim = new AVRSimulator(pm);
    events = [];
    sim.onPinChangeWithTime = (pin, state, timeMs) => {
      events.push({ pin, state, timeMs });
    };
    sim.loadHex(EMPTY_HEX);
  });
  afterEach(() => sim.stop());

  it('seeds the TX pin HIGH (idle) when TXEN flips 0 → 1', () => {
    configureUsartFor115200(sim);

    // The first thing the scope should see on PD1 is an idle-HIGH sample.
    const txEvents = events.filter((e) => e.pin === 1);
    expect(txEvents.length).toBeGreaterThanOrEqual(1);
    expect(txEvents[0].state).toBe(true);
  });

  it('emits a complete 10-bit UART frame for a byte with internal transitions', () => {
    configureUsartFor115200(sim);
    events = []; // discard the idle-seed event so we only inspect the frame

    // 'a' = 0x61 = 0b01100001 → LSB-first bits: 1, 0, 0, 0, 0, 1, 1, 0
    //   start  bit0  bit1  bit2  bit3  bit4  bit5  bit6  bit7  stop
    //   LOW    HIGH  LOW   LOW   LOW   LOW   HIGH  HIGH  LOW   HIGH
    // Transitions vs. prev (starting from idle HIGH):
    //   t0 LOW (start), t1 HIGH (b0), t2 LOW (b1), t6 HIGH (b5),
    //   t8 LOW (b7), t9 HIGH (stop)
    sim.usart!.onByteTransmit!(0x61);

    const txEvents = events.filter((e) => e.pin === 1);
    const states = txEvents.map((e) => e.state);
    expect(states).toEqual([false, true, false, true, false, true]);
  });

  it('handles 0xFF (all ones) — only start bit drop, then stop-bit rise', () => {
    configureUsartFor115200(sim);
    events = [];

    // 0xFF: start LOW, then 8x HIGH (no internal transitions), then stop HIGH.
    // Only 1 LOW (start) and 1 HIGH (first data bit, which is also the rest).
    sim.usart!.onByteTransmit!(0xff);

    const txEvents = events.filter((e) => e.pin === 1);
    expect(txEvents.map((e) => e.state)).toEqual([false, true]);
  });

  it('does not emit anything when TXEN is disabled', () => {
    // Don't configure UCSRB — TXEN remains 0.
    events = [];
    sim.usart!.onByteTransmit!(0x61);

    const txEvents = events.filter((e) => e.pin === 1);
    expect(txEvents).toHaveLength(0);
  });

  it('uses the configured baud rate for bit timing (1 bit ≈ 1/baud seconds)', () => {
    configureUsartFor115200(sim);
    events = [];

    // 0x00 produces transitions at: t0 LOW (start) and t9 HIGH (stop only).
    sim.usart!.onByteTransmit!(0x00);

    const txEvents = events.filter((e) => e.pin === 1);
    expect(txEvents).toHaveLength(2);
    const dtMs = txEvents[1].timeMs - txEvents[0].timeMs;
    // 9 bit periods between start LOW and stop HIGH at 16M/(16*9) = 111111 baud:
    //   bitMs = 1000 / 111111 ≈ 0.009 ms, 9 * 0.009 ≈ 0.081 ms
    expect(dtMs).toBeCloseTo((9 * 1000) / 111111, 3);
  });
});
