/**
 * cyw43_emulator_tier0
 *
 * Tier-0 stub of the CYW43439 chip — implements just enough behaviour
 * for the host driver's `cyw43_ll_bus_init()` to succeed and for the
 * host LED IOCTL to be observable from outside.
 *
 * This is a **state machine on the bus side**, NOT a model of the
 * chip's internal CPU. It answers register reads with the values the
 * driver expects and silently absorbs writes (including the 224 KB
 * firmware blob, which is ignored — see
 *   ../autosearch/06_firmware_blob_question.md).
 *
 * Public surface:
 *   onCommand(cmd, payload) — feed a sniffed gSPI command. Returns the
 *                             bytes the chip "would have" returned,
 *                             or null for write commands.
 *   onLed(callback)         — register a hook that fires whenever the
 *                             driver toggles the on-board LED via the
 *                             gpioout IOCTL.
 */

import type { Cyw43Cmd } from './pio_bus_sniffer.js';

/** Magic value the driver polls F0:0x14 for. */
const TEST_PATTERN = 0xfeedbead >>> 0;

/** F0 register addresses we care about for Tier 0. */
const F0 = {
  BUS_CTL: 0x00,
  RESPONSE_DELAY: 0x04,
  STATUS_ENABLE: 0x08,
  RESET_BP: 0x0c,
  READ_TEST: 0x14,
  WRITE_TEST: 0x18,
  INTERRUPT: 0x20,
  INTERRUPT_ENABLE: 0x24,
  BUS_CTL2: 0x2c,
  FUNCTION_INT_MASK: 0x30,
  F2_INFO: 0x3c,
} as const;

/** F1 backplane addresses we synthesise. */
const F1 = {
  // SDIO core (driver reuses these in gSPI mode)
  SDIO_CHIP_CLOCK_CSR: 0x1000e,
  // Backplane window registers
  SDIO_BACKPLANE_ADDRESS_LOW: 0x1000a,
  SDIO_BACKPLANE_ADDRESS_MID: 0x1000b,
  SDIO_BACKPLANE_ADDRESS_HIGH: 0x1000c,
} as const;

/** Bits in SDIO_CHIP_CLOCK_CSR. */
const SBSDIO_ALP_AVAIL_REQ = 0x08;
const SBSDIO_HT_AVAIL_REQ = 0x10;
const SBSDIO_ALP_AVAIL = 0x40;
const SBSDIO_HT_AVAIL = 0x80;

export interface LedEvent {
  on: boolean;
  /** Approximate timestamp in ms since the chip booted. */
  t: number;
}
export type LedListener = (ev: LedEvent) => void;

/**
 * Tier-0 stub.
 */
export class Cyw43EmulatorTier0 {
  /** Boot timestamp for relative t in events. */
  private bootMs = Date.now();
  /** F0 register store — flat 64-byte block. */
  private f0Regs: Uint32Array = new Uint32Array(16);
  /** F1 backplane "current address" pointer (24-bit). */
  private f1Window = 0;
  /** Synthesised SDIO_CHIP_CLOCK_CSR shadow. */
  private clockCsr = 0;
  /** Listeners. */
  private ledListeners: LedListener[] = [];
  /** Hold-down for read-test register: returns 0 on first read, magic after. */
  private readTestPrimed = false;

  constructor() {
    // F0:0x3C F2_INFO — bit 0 = F2 ready. We assert it immediately.
    // Real chip waits for firmware to boot (~30 ms); the driver tolerates
    // it being early.
    this.f0Regs[F0.F2_INFO >> 2] = 0x01;

    // SBSDIO clock state — start with ALP available (low-power clock),
    // flip HT_AVAIL when the driver asks for it (in onCommand).
    this.clockCsr = SBSDIO_ALP_AVAIL;
  }

  onLed(cb: LedListener): () => void {
    this.ledListeners.push(cb);
    return () => {
      const i = this.ledListeners.indexOf(cb);
      if (i >= 0) this.ledListeners.splice(i, 1);
    };
  }

  /**
   * Apply a gSPI command observed on the wire.
   * For WR commands ``payload`` carries the data the driver wrote.
   * For RD commands ``payload.length`` is the byte count requested;
   * the function returns the response the chip would have driven.
   */
  onCommand(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (cmd.function === 0) return this.handleF0(cmd, payload);
    if (cmd.function === 1) return this.handleF1(cmd, payload);
    if (cmd.function === 2) return this.handleF2(cmd, payload);
    return cmd.write ? null : new Uint8Array(cmd.length);
  }

  // ── F0 ────────────────────────────────────────────────────────────

  private handleF0(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    const idx = cmd.address >>> 2;
    if (cmd.write) {
      const word = readU32LE(payload, 0);
      if (idx >= 0 && idx < this.f0Regs.length) this.f0Regs[idx] = word;
      // Reset-backplane (0x0C) clears the F1 window pointer.
      if (cmd.address === F0.RESET_BP) this.f1Window = 0;
      return null;
    }
    // Read.
    const out = new Uint8Array(cmd.length);
    if (cmd.address === F0.READ_TEST) {
      // First read after reset returns 0; subsequent reads return magic.
      // This matches how Iosoft observed real silicon and how the driver
      // tolerates the race.
      const value = this.readTestPrimed ? TEST_PATTERN : 0;
      this.readTestPrimed = true;
      writeU32LE(out, 0, value);
    } else if (idx >= 0 && idx < this.f0Regs.length) {
      writeU32LE(out, 0, this.f0Regs[idx]);
    }
    return out;
  }

  // ── F1 backplane ─────────────────────────────────────────────────

  private handleF1(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (cmd.write) {
      // Track backplane window register writes (the driver streams
      // firmware via auto-increment; we don't store any of it).
      if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_LOW) {
        this.f1Window = (this.f1Window & 0xffff00) | (payload[0] ?? 0);
      } else if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_MID) {
        this.f1Window = (this.f1Window & 0xff00ff) | ((payload[0] ?? 0) << 8);
      } else if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_HIGH) {
        this.f1Window = (this.f1Window & 0x00ffff) | ((payload[0] ?? 0) << 16);
      } else if (cmd.address === F1.SDIO_CHIP_CLOCK_CSR) {
        const requested = payload[0] ?? 0;
        // Flip the corresponding "available" bit so the driver's poll
        // succeeds without a real chip clock domain.
        if (requested & SBSDIO_ALP_AVAIL_REQ) this.clockCsr |= SBSDIO_ALP_AVAIL;
        if (requested & SBSDIO_HT_AVAIL_REQ) this.clockCsr |= SBSDIO_HT_AVAIL;
      }
      // Auto-increment window pointer for sequential writes (firmware,
      // NVRAM). We're not actually storing the bytes anywhere.
      if (cmd.increment) this.f1Window += cmd.length;
      return null;
    }

    // Reads.
    const out = new Uint8Array(cmd.length);
    if (cmd.address === F1.SDIO_CHIP_CLOCK_CSR) {
      out[0] = this.clockCsr & 0xff;
    } else {
      // Anything else: zero. Real chip would return chipcommon ID etc.,
      // but the Tier-0 contract is "pretend the firmware loaded fine"
      // and almost no codepath reads back from the firmware window.
    }
    if (cmd.increment) this.f1Window += cmd.length;
    return out;
  }

  // ── F2 frame channel — Tier 0 just acks LED IOCTLs ────────────────

  private handleF2(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (!cmd.write) {
      // Driver reads incoming events. Tier 0 has nothing to surface.
      return new Uint8Array(cmd.length);
    }

    // Outbound SDPCM frame. Layout (Broadcom):
    //   uint16 size; uint16 size_complement; uint8 sequence;
    //   uint8 channel; uint8 next_length; uint8 header_length;
    //   uint8 flow_ctl; uint8 credit; uint16 reserved;
    if (payload.length < 12) return null;
    const channel = payload[5];
    const headerLength = payload[7];

    if (channel === 0) {
      // Channel 0 = control / IOCTL. Inside is a CDC header followed
      // by a name string and (optionally) a payload.
      const cdcOff = headerLength;
      const cdcCmd = readU32LE(payload, cdcOff + 0);
      const _cdcLen = readU32LE(payload, cdcOff + 4);
      const _cdcFlags = readU32LE(payload, cdcOff + 8);
      const _cdcStatus = readU32LE(payload, cdcOff + 12);
      const dataOff = cdcOff + 16;

      // WLC_SET_VAR is the multi-purpose command. The variable name is
      // a NUL-terminated string starting at dataOff.
      const WLC_SET_VAR = 263;
      if (cdcCmd === WLC_SET_VAR) {
        const name = readCString(payload, dataOff);
        if (name === 'gpioout') {
          // Payload after the name: <uint32 gpiomask> <uint32 gpiovalue>
          const valOff = dataOff + name.length + 1;
          if (valOff + 8 <= payload.length) {
            const mask = readU32LE(payload, valOff);
            const value = readU32LE(payload, valOff + 4);
            // Bit 0 in the LED mask is the on-board WL LED on Pico W.
            if (mask & 0x1) {
              this.fireLed((value & 0x1) === 0x1);
            }
          }
        }
      }
    }
    return null;
  }

  private fireLed(on: boolean): void {
    const ev: LedEvent = { on, t: Date.now() - this.bootMs };
    for (const cb of this.ledListeners) {
      try { cb(ev); } catch { /* swallow — research harness */ }
    }
  }
}

// ── small helpers ─────────────────────────────────────────────────

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
  );
}

function writeU32LE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >>> 8) & 0xff;
  buf[off + 2] = (value >>> 16) & 0xff;
  buf[off + 3] = (value >>> 24) & 0xff;
}

function readCString(buf: Uint8Array, off: number): string {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(buf.subarray(off, end));
}
