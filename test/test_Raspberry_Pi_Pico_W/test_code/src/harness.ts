/**
 * harness.ts
 *
 * Glue that attaches a PioBusSniffer + Cyw43EmulatorTier0 to a real
 * rp2040js instance. This is the smallest plausible reproduction of
 * what the Velxio frontend would do at Tier 0 — see
 *   ../autosearch/04_emulation_design.md  §"Architecture sketch".
 *
 * Production code would live in
 *   frontend/src/simulation/cyw43/Cyw43Bridge.ts
 * and wire the same plumbing into RP2040Simulator.ts.
 */

import { Cyw43EmulatorTier0, type LedEvent } from './cyw43_emulator_tier0.js';
import { PioBusSniffer, formatCmd, type SnifferEvent } from './pio_bus_sniffer.js';

export interface HarnessOptions {
  /** Print every decoded gSPI command to stderr. Off by default. */
  verbose?: boolean;
  /** Set to true to capture the trace log into options.trace.lines. */
  capture?: boolean;
}

export class Cyw43Harness {
  readonly emulator = new Cyw43EmulatorTier0();
  private sniffer = new PioBusSniffer();
  private pendingCmd: SnifferEvent | null = null;
  readonly trace: string[] = [];
  private opts: HarnessOptions;

  constructor(opts: HarnessOptions = {}) {
    this.opts = opts;
  }

  /**
   * Feed one 32-bit word as it would have appeared in the PIO TX FIFO.
   * Returns the response bytes the chip would have driven on the wire,
   * or null for write transactions.
   */
  feedTxWord(word: number): Uint8Array | null {
    let lastResponse: Uint8Array | null = null;
    for (const ev of this.sniffer.feedWord(word)) {
      if (ev.kind === 'header') {
        if (this.opts.verbose) console.error('[cyw43] →', formatCmd(ev.cmd));
        if (this.opts.capture) this.trace.push(`→ ${formatCmd(ev.cmd)}`);
        this.pendingCmd = ev;
      } else if (ev.kind === 'payload') {
        const reply = this.emulator.onCommand(ev.cmd, ev.payload);
        if (this.opts.verbose && reply && reply.length > 0) {
          const hex = Array.from(reply.slice(0, 16))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ');
          console.error(`[cyw43] ← ${hex}${reply.length > 16 ? ' …' : ''}`);
        }
        if (this.opts.capture) {
          if (reply) {
            const hex = Array.from(reply.slice(0, 16))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(' ');
            this.trace.push(`← (${reply.length} B) ${hex}${reply.length > 16 ? ' …' : ''}`);
          }
        }
        if (reply) lastResponse = reply;
        this.pendingCmd = null;
      }
    }
    return lastResponse;
  }

  onLed(cb: (ev: LedEvent) => void): () => void {
    return this.emulator.onLed(cb);
  }
}
