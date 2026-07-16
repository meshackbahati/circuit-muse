/**
 * 04_sdpcm.test.ts
 *
 * Round-trip tests for the SDPCM/CDC framing layer used between the
 * host driver and the chip. No emulator state involved; this validates
 * that we can pack and unpack the wire format the next test layer
 * relies on.
 */

import { describe, it, expect } from 'vitest';
import { SdpcmChannel } from '../src/cyw43_constants.js';
import {
  CDC_HEADER_LEN,
  decodeCdc,
  decodeEventBody,
  decodeSdpcm,
  encodeCdc,
  encodeEventFrame,
  encodeIoctlRequest,
  encodeSdpcm,
  SDPCM_HEADER_LEN,
} from '../src/sdpcm.js';

describe('SDPCM framing', () => {
  it('encode/decode round-trips a control frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeSdpcm({
      channel: SdpcmChannel.CONTROL,
      sequence: 7,
      payload,
    });
    expect(buf.length).toBe(SDPCM_HEADER_LEN + payload.length);
    const f = decodeSdpcm(buf);
    expect(f).not.toBeNull();
    if (f) {
      expect(f.channel).toBe(SdpcmChannel.CONTROL);
      expect(f.sequence).toBe(7);
      expect(Array.from(f.payload)).toEqual(Array.from(payload));
    }
  });

  it('rejects a frame whose size complement is wrong', () => {
    const buf = new Uint8Array(20);
    buf[0] = 20; buf[1] = 0;
    buf[2] = 0; buf[3] = 0; // wrong complement
    buf[7] = SDPCM_HEADER_LEN;
    expect(decodeSdpcm(buf)).toBeNull();
  });

  it('rejects a header-length larger than total size', () => {
    const buf = encodeSdpcm({
      channel: SdpcmChannel.DATA,
      sequence: 0,
      payload: new Uint8Array(0),
    });
    buf[7] = 99;
    expect(decodeSdpcm(buf)).toBeNull();
  });
});

describe('CDC framing', () => {
  it('encodes the documented field offsets', () => {
    const buf = encodeCdc({
      cmd: 263,
      outlen: 0,
      inlen: 12,
      flags: 0xdeadbeef,
      status: 0,
      payload: new Uint8Array([0xaa, 0xbb]),
    });
    expect(buf.length).toBe(CDC_HEADER_LEN + 2);
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0, true)).toBe(263);
    expect(dv.getUint16(4, true)).toBe(0);
    expect(dv.getUint16(6, true)).toBe(12);
    expect(dv.getUint32(8, true) >>> 0).toBe(0xdeadbeef);
  });

  it('round-trips through decode', () => {
    const buf = encodeCdc({
      cmd: 26,
      outlen: 36,
      inlen: 36,
      flags: 0,
      status: 0,
      payload: new Uint8Array([0, 0, 0, 0]),
    });
    const cdc = decodeCdc(buf);
    expect(cdc).not.toBeNull();
    if (cdc) {
      expect(cdc.cmd).toBe(26);
      expect(cdc.inlen).toBe(36);
    }
  });
});

describe('encodeIoctlRequest', () => {
  it('produces an SDPCM channel-0 frame containing a valid CDC header', () => {
    const frame = encodeIoctlRequest(
      /*sequence*/ 1,
      /*cmd*/ 263,
      /*flags*/ 0x12340001,
      /*outlen*/ 0,
      /*payload*/ new Uint8Array([0x01, 0x02]),
    );
    const sdpcm = decodeSdpcm(frame);
    expect(sdpcm).not.toBeNull();
    if (!sdpcm) return;
    expect(sdpcm.channel).toBe(SdpcmChannel.CONTROL);
    const cdc = decodeCdc(sdpcm.payload);
    expect(cdc).not.toBeNull();
    if (!cdc) return;
    expect(cdc.cmd).toBe(263);
    expect(Array.from(cdc.payload)).toEqual([0x01, 0x02]);
  });
});

describe('event frames', () => {
  it('encode/decode round-trips a WLC_E event with payload', () => {
    const payload = new Uint8Array([0x10, 0x20, 0x30]);
    const sdpcm = encodeEventFrame(
      /*sequence*/ 5,
      /*eventType*/ 16, // WLC_E_LINK
      /*status*/ 0,
      /*reason*/ 1,
      payload,
    );
    const sdpcmFrame = decodeSdpcm(sdpcm);
    expect(sdpcmFrame).not.toBeNull();
    if (!sdpcmFrame) return;
    expect(sdpcmFrame.channel).toBe(SdpcmChannel.EVENT);
    const ev = decodeEventBody(sdpcmFrame.payload);
    expect(ev).not.toBeNull();
    if (!ev) return;
    expect(ev.eventType).toBe(16);
    expect(ev.status).toBe(0);
    expect(ev.reason).toBe(1);
    expect(ev.datalen).toBe(payload.length);
    expect(Array.from(ev.data)).toEqual(Array.from(payload));
  });
});
