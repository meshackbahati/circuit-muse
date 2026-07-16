/**
 * 01_pio_decoder.test.ts
 *
 * Pure unit tests for the gSPI command decoder. No emulator, no
 * rp2040js — just verifies the bit layout.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeHeader,
  PioBusSniffer,
  swap16x2,
  formatCmd,
} from '../src/pio_bus_sniffer.js';

/** Helper — build a header word from fields. */
function makeHeader(opts: {
  write: boolean;
  increment: boolean;
  function: 0 | 1 | 2 | 3;
  address: number;
  length: number;
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

describe('decodeHeader', () => {
  it('decodes a 4-byte F0 read of the test register', () => {
    const hdr = makeHeader({
      write: false,
      increment: true,
      function: 0,
      address: 0x14,
      length: 4,
    });
    const cmd = decodeHeader(hdr);
    expect(cmd.write).toBe(false);
    expect(cmd.increment).toBe(true);
    expect(cmd.function).toBe(0);
    expect(cmd.address).toBe(0x14);
    expect(cmd.length).toBe(4);
  });

  it('decodes a maximal-length F2 write (2047 bytes — 11-bit field)', () => {
    // The length field is 11 bits in the gSPI command word (mask 0x7FF),
    // so 2047 is the maximal value representable directly. The spec
    // says "up to 2 KB" and some drivers encode 2048 as 0 (wrap), but
    // that's a driver convention, not a decoder property.
    const hdr = makeHeader({
      write: true,
      increment: true,
      function: 2,
      address: 0x10000,
      length: 2047,
    });
    const cmd = decodeHeader(hdr);
    expect(cmd.write).toBe(true);
    expect(cmd.function).toBe(2);
    expect(cmd.length).toBe(2047);
  });

  it('preserves all 17 address bits', () => {
    const hdr = makeHeader({
      write: true,
      increment: false,
      function: 1,
      address: 0x1ffff,
      length: 0,
    });
    expect(decodeHeader(hdr).address).toBe(0x1ffff);
  });
});

describe('swap16x2', () => {
  it('swaps the two 16-bit halves', () => {
    expect(swap16x2(0xaabbccdd)).toBe(0xccddaabb);
    expect(swap16x2(0x00000000)).toBe(0x00000000);
    expect(swap16x2(0xffffffff)).toBe(0xffffffff);
  });

  it('is an involution', () => {
    const w = 0x12345678;
    expect(swap16x2(swap16x2(w))).toBe(w);
  });
});

describe('PioBusSniffer', () => {
  it('emits a header event after one TX word', () => {
    const sniffer = new PioBusSniffer();
    const hostHdr = makeHeader({
      write: false,
      increment: true,
      function: 0,
      address: 0x14,
      length: 4,
    });
    // The driver halfword-swaps before pushing into the PIO FIFO, so
    // the sniffer expects a swapped value on input.
    const wireWord = swap16x2(hostHdr);
    const events = [...sniffer.feedWord(wireWord)];
    // 4-byte read → still need 1 payload word; header alone yields just
    // the 'header' event.
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('header');
    if (events[0].kind === 'header') {
      expect(events[0].cmd.address).toBe(0x14);
    }
  });

  it('reassembles a 4-byte payload across one extra word', () => {
    const sniffer = new PioBusSniffer();
    const hostHdr = makeHeader({
      write: true,
      increment: true,
      function: 0,
      address: 0x18,
      length: 4,
    });
    const events1 = [...sniffer.feedWord(swap16x2(hostHdr))];
    expect(events1.map((e) => e.kind)).toEqual(['header']);

    // Payload word: 0xAD 0x4F 0xEE 0xDB → host order LE = 0xDBEE4FAD;
    // pre-swap on the wire = swap16x2(0xDBEE4FAD).
    const payloadHostLE = 0xdbee4fad >>> 0;
    const events2 = [...sniffer.feedWord(swap16x2(payloadHostLE))];
    expect(events2.map((e) => e.kind)).toEqual(['payload']);
    if (events2[0].kind === 'payload') {
      expect(Array.from(events2[0].payload)).toEqual([0xad, 0x4f, 0xee, 0xdb]);
    }
  });

  it('emits a zero-length payload for header-only transactions', () => {
    const sniffer = new PioBusSniffer();
    const hostHdr = makeHeader({
      write: true,
      increment: false,
      function: 0,
      address: 0x0c,
      length: 0,
    });
    const events = [...sniffer.feedWord(swap16x2(hostHdr))];
    expect(events.map((e) => e.kind)).toEqual(['header', 'payload']);
  });
});

describe('formatCmd', () => {
  it('produces a one-line summary', () => {
    const cmd = decodeHeader(
      makeHeader({
        write: false,
        increment: true,
        function: 0,
        address: 0x14,
        length: 4,
      }),
    );
    expect(formatCmd(cmd)).toBe('RD F0+ addr=0x00014 len=4');
  });
});
