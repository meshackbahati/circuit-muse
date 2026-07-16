/**
 * 02_handshake.test.ts
 *
 * Drives the Tier-0 emulator with a synthetic mini-driver that mimics
 * the first few register operations cyw43_ll_bus_init() performs.
 * Asserts the chip reports 0xFEEDBEAD on F0:0x14 and SBSDIO_HT_AVAIL on
 * F1:SDIO_CHIP_CLOCK_CSR — the two synchronisation points the real
 * driver waits for.
 *
 * No real firmware blob, no rp2040js, no PIO. The point of this test
 * is to validate the **bus-state machine** in isolation; downstream
 * tests can then trust that piece.
 */

import { describe, it, expect } from 'vitest';
import { Cyw43EmulatorTier0 } from '../src/cyw43_emulator_tier0.js';
import { decodeHeader } from '../src/pio_bus_sniffer.js';

function makeHeader(opts: {
  write: boolean;
  function: 0 | 1 | 2 | 3;
  address: number;
  length: number;
  increment?: boolean;
}): number {
  return (
    (((opts.write ? 1 : 0) << 31) |
      ((opts.increment ? 1 : 0) << 30) |
      (opts.function << 28) |
      ((opts.address & 0x1ffff) << 11) |
      (opts.length & 0x7ff)) >>>
    0
  );
}

function readU32(buf: Uint8Array): number {
  return (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
}

describe('Cyw43EmulatorTier0 — handshake', () => {
  it('returns 0 on first F0:0x14 read, then 0xFEEDBEAD', () => {
    const chip = new Cyw43EmulatorTier0();
    const cmd = decodeHeader(
      makeHeader({ write: false, function: 0, address: 0x14, length: 4 }),
    );
    const r1 = chip.onCommand(cmd, new Uint8Array(0));
    const r2 = chip.onCommand(cmd, new Uint8Array(0));
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    if (r1 && r2) {
      expect(readU32(r1)).toBe(0); // first read after reset
      expect(readU32(r2)).toBe(0xfeedbead);
    }
  });

  it('echoes F0:0x18 write/read test pattern', () => {
    const chip = new Cyw43EmulatorTier0();
    const wrCmd = decodeHeader(
      makeHeader({ write: true, function: 0, address: 0x18, length: 4 }),
    );
    const rdCmd = decodeHeader(
      makeHeader({ write: false, function: 0, address: 0x18, length: 4 }),
    );
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    chip.onCommand(wrCmd, payload);
    const r = chip.onCommand(rdCmd, new Uint8Array(0));
    expect(r).not.toBeNull();
    if (r) expect(Array.from(r)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it('flips SBSDIO_HT_AVAIL after a HT_AVAIL_REQ write', () => {
    const chip = new Cyw43EmulatorTier0();
    const SDIO_CHIP_CLOCK_CSR = 0x1000e;
    const HT_AVAIL_REQ = 0x10;
    const HT_AVAIL = 0x80;

    // 1) Initial read — chip should already have ALP_AVAIL set, no HT yet.
    const rdCmd = decodeHeader(
      makeHeader({ write: false, function: 1, address: SDIO_CHIP_CLOCK_CSR, length: 1 }),
    );
    const r0 = chip.onCommand(rdCmd, new Uint8Array(0));
    expect(r0).not.toBeNull();
    if (r0) expect((r0[0] & HT_AVAIL) >>> 0).toBe(0);

    // 2) Write HT_AVAIL_REQ.
    const wrCmd = decodeHeader(
      makeHeader({ write: true, function: 1, address: SDIO_CHIP_CLOCK_CSR, length: 1 }),
    );
    chip.onCommand(wrCmd, new Uint8Array([HT_AVAIL_REQ]));

    // 3) Subsequent read returns HT_AVAIL set.
    const r1 = chip.onCommand(rdCmd, new Uint8Array(0));
    expect(r1).not.toBeNull();
    if (r1) expect((r1[0] & HT_AVAIL) !== 0).toBe(true);
  });

  it('reports F2 ready on F0:0x3C immediately', () => {
    const chip = new Cyw43EmulatorTier0();
    const rdCmd = decodeHeader(
      makeHeader({ write: false, function: 0, address: 0x3c, length: 4 }),
    );
    const r = chip.onCommand(rdCmd, new Uint8Array(0));
    expect(r).not.toBeNull();
    if (r) expect((readU32(r) & 0x1) === 0x1).toBe(true);
  });

  it('absorbs a 224 KB firmware stream without error', () => {
    const chip = new Cyw43EmulatorTier0();
    // Simulate the driver streaming firmware in 64-byte F1 writes with
    // auto-increment. We're not asserting anything — just that the
    // emulator doesn't throw or leak memory across many commands.
    const total = 224 * 1024;
    const chunkSize = 64;
    let written = 0;
    while (written < total) {
      const n = Math.min(chunkSize, total - written);
      const wrCmd = decodeHeader(
        makeHeader({
          write: true,
          increment: true,
          function: 1,
          address: 0x00, // bulk RAM start
          length: n,
        }),
      );
      chip.onCommand(wrCmd, new Uint8Array(n));
      written += n;
    }
    expect(written).toBe(total);
  });
});

describe('Cyw43EmulatorTier0 — LED IOCTL', () => {
  it('fires onLed when the gpioout IOCTL is received', () => {
    const chip = new Cyw43EmulatorTier0();
    const events: { on: boolean }[] = [];
    chip.onLed((ev) => events.push({ on: ev.on }));

    // Build an SDPCM frame on channel 0 (control / IOCTL) carrying a
    // WLC_SET_VAR with name "gpioout" and payload <mask=0x01,value=0x01>.
    const sdpcm = buildSdpcmIoctl('gpioout', new Uint8Array([0x01, 0, 0, 0, 0x01, 0, 0, 0]));
    const wrCmd = decodeHeader(
      makeHeader({ write: true, function: 2, address: 0, length: sdpcm.length }),
    );
    chip.onCommand(wrCmd, sdpcm);

    expect(events).toEqual([{ on: true }]);

    // Now turn it off.
    const sdpcmOff = buildSdpcmIoctl('gpioout', new Uint8Array([0x01, 0, 0, 0, 0x00, 0, 0, 0]));
    chip.onCommand(wrCmd, sdpcmOff);
    expect(events).toEqual([{ on: true }, { on: false }]);
  });
});

/** Build a minimal SDPCM-channel-0 frame carrying a WLC_SET_VAR IOCTL. */
function buildSdpcmIoctl(varName: string, varPayload: Uint8Array): Uint8Array {
  const WLC_SET_VAR = 263;
  const sdpcmHeaderLen = 12;
  const cdcHeaderLen = 16;
  const nameBytes = new TextEncoder().encode(varName);
  const totalLen =
    sdpcmHeaderLen + cdcHeaderLen + nameBytes.length + 1 /* NUL */ + varPayload.length;

  const buf = new Uint8Array(totalLen);
  const dv = new DataView(buf.buffer);

  // SDPCM header
  dv.setUint16(0, totalLen, true);
  dv.setUint16(2, ~totalLen & 0xffff, true);
  buf[4] = 0; // sequence
  buf[5] = 0; // channel = control
  buf[6] = 0; // next_length
  buf[7] = sdpcmHeaderLen; // header_length
  buf[8] = 0; // flow_ctl
  buf[9] = 0; // credit
  // bytes 10-11 reserved

  // CDC header (LE)
  let off = sdpcmHeaderLen;
  dv.setUint32(off + 0, WLC_SET_VAR, true);
  dv.setUint32(off + 4, nameBytes.length + 1 + varPayload.length, true);
  dv.setUint32(off + 8, 0, true); // flags
  dv.setUint32(off + 12, 0, true); // status
  off += cdcHeaderLen;

  // varName + NUL
  buf.set(nameBytes, off);
  off += nameBytes.length;
  buf[off] = 0;
  off += 1;

  // varPayload (mask + value)
  buf.set(varPayload, off);

  return buf;
}
