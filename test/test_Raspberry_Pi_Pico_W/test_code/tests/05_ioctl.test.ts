/**
 * 05_ioctl.test.ts
 *
 * Drives the Cyw43Emulator with synthetic IOCTL requests (the same
 * shape the cyw43-driver puts on the wire) and asserts every reply the
 * driver depends on for `cyw43_ll_wifi_init()` plus the basics of the
 * STA control plane.
 */

import { describe, it, expect } from 'vitest';
import { Cyw43Emulator, WLC, WLC_E } from '../src/cyw43_emulator.js';
import { decodeHeader } from '../src/pio_bus_sniffer.js';
import {
  decodeCdc,
  decodeEventBody,
  decodeSdpcm,
  encodeIoctlRequest,
} from '../src/sdpcm.js';
import { SdpcmChannel } from '../src/cyw43_constants.js';
import { DEFAULT_AP, DEFAULT_STA_MAC, formatMac } from '../src/virtual_ap.js';

function makeF2Hdr(opts: { write: boolean; length: number }) {
  return decodeHeader(
    (((opts.write ? 1 : 0) << 31) |
      (1 << 30) /* increment */ |
      (2 << 28) /* function 2 */ |
      0 |
      (opts.length & 0x7ff)) >>>
      0,
  );
}

/** Drive an IOCTL into the chip, then drain the inbound queue and find the matching reply. */
function ioctl(
  chip: Cyw43Emulator,
  cmd: number,
  payload: Uint8Array = new Uint8Array(0),
  opts: { isSet?: boolean; outlen?: number } = {},
): { status: number; data: Uint8Array; events: Array<{ type: number; status: number; reason: number; data: Uint8Array }> } {
  const flags = (opts.isSet === false ? 0 : 1);
  const outlen = opts.outlen ?? 0;
  const sdpcm = encodeIoctlRequest(0, cmd, flags, outlen, payload);
  // Push the host frame.
  chip.onCommand(makeF2Hdr({ write: true, length: sdpcm.length }), sdpcm);

  // Drain the chip-→host queue. We pull until empty.
  let reply: { status: number; data: Uint8Array } = {
    status: 0xffff,
    data: new Uint8Array(0),
  };
  const events: Array<{ type: number; status: number; reason: number; data: Uint8Array }> = [];

  for (let i = 0; i < 32; i++) {
    const out = chip.onCommand(makeF2Hdr({ write: false, length: 1600 }), new Uint8Array(0));
    if (!out || out.every((b) => b === 0)) break;
    const sdpcmFrame = decodeSdpcm(out);
    if (!sdpcmFrame) break;
    if (sdpcmFrame.channel === SdpcmChannel.CONTROL) {
      const cdc = decodeCdc(sdpcmFrame.payload);
      if (cdc && cdc.cmd === cmd) {
        reply = { status: cdc.status, data: cdc.payload.slice(0, cdc.outlen) };
      }
    } else if (sdpcmFrame.channel === SdpcmChannel.EVENT) {
      const ev = decodeEventBody(sdpcmFrame.payload);
      if (ev) events.push({ type: ev.eventType, status: ev.status, reason: ev.reason, data: ev.data });
    }
  }
  return { ...reply, events };
}

describe('IOCTL surface', () => {
  it('GET_MAGIC returns 0x14e46c77', () => {
    const chip = new Cyw43Emulator();
    const r = ioctl(chip, WLC.GET_MAGIC, new Uint8Array(0), { isSet: false, outlen: 4 });
    const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    expect(dv.getUint32(0, true) >>> 0).toBe(0x14e46c77);
  });

  it('UP/DOWN flips the WLC state', () => {
    const chip = new Cyw43Emulator();
    expect(chip.isUp()).toBe(false);
    ioctl(chip, WLC.UP);
    expect(chip.isUp()).toBe(true);
    ioctl(chip, WLC.DOWN);
    expect(chip.isUp()).toBe(false);
  });

  it('GET_VAR cur_etheraddr returns the STA MAC', () => {
    const chip = new Cyw43Emulator();
    const name = new TextEncoder().encode('cur_etheraddr\0');
    const r = ioctl(chip, WLC.GET_VAR, name, { isSet: false, outlen: 6 });
    expect(r.data.length).toBe(6);
    expect(formatMac(r.data)).toBe(formatMac(DEFAULT_STA_MAC));
  });

  it('SET_VAR gpioout {mask=1,value=1} fires the LED listener', () => {
    const chip = new Cyw43Emulator();
    const events: boolean[] = [];
    chip.onLed((ev) => events.push(ev.on));

    const name = new TextEncoder().encode('gpioout\0');
    const value = new Uint8Array(8);
    new DataView(value.buffer).setUint32(0, 0x01, true); // mask
    new DataView(value.buffer).setUint32(4, 0x01, true); // value = on
    const payload = new Uint8Array(name.length + value.length);
    payload.set(name); payload.set(value, name.length);
    ioctl(chip, WLC.SET_VAR, payload);

    new DataView(value.buffer).setUint32(4, 0x00, true); // value = off
    payload.set(value, name.length);
    ioctl(chip, WLC.SET_VAR, payload);

    expect(events).toEqual([true, false]);
  });

  it('SCAN emits an ESCAN_RESULT containing Velxio-GUEST + a SCAN_COMPLETE', () => {
    const chip = new Cyw43Emulator();
    const r = ioctl(chip, WLC.SCAN);
    const escan = r.events.find((e) => e.type === WLC_E.ESCAN_RESULT);
    const complete = r.events.find((e) => e.type === WLC_E.SCAN_COMPLETE);
    expect(escan).toBeDefined();
    expect(complete).toBeDefined();
    if (escan) {
      const dv = new DataView(escan.data.buffer, escan.data.byteOffset, escan.data.byteLength);
      const bssCount = dv.getUint16(10, true);
      expect(bssCount).toBe(1);
      // BSS info begins at offset 12, version=109, length=N, then bssid (6).
      const bssOff = 12;
      const bssid = escan.data.slice(bssOff + 8, bssOff + 14);
      expect(formatMac(bssid)).toBe(formatMac(DEFAULT_AP.bssid));
      // BSS info layout (relative to bssOff):
      //   0  uint32 version
      //   4  uint32 length
      //   8  uint8[6] bssid
      //  14  uint16 beacon_period
      //  16  uint16 capability
      //  18  uint8 ssid_len
      //  19  uint8[32] ssid
      const ssidLen = escan.data[bssOff + 18];
      const ssid = new TextDecoder().decode(escan.data.subarray(bssOff + 19, bssOff + 19 + ssidLen));
      expect(ssid).toBe('Velxio-GUEST');
    }
  });
});
