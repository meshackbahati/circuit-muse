/**
 * 06_full_lifecycle.test.ts
 *
 * Walks the chip through a complete WiFi lifecycle:
 *   1. bus init   — FEEDBEAD handshake + clock CSR
 *   2. WLC_UP
 *   3. SCAN       — finds Velxio-GUEST
 *   4. SET_SSID   — joins Velxio-GUEST
 *   5. observes WLC_E_LINK with link-up bit
 *   6. GET_BSSID  — returns the AP's BSSID
 *   7. sends an outbound Ethernet frame, observes onPacketOut
 *   8. injects an inbound frame, observes the data on F2 read
 *   9. WLC_DOWN   — emits DEAUTH + LINK-down events
 *
 * Same harness style as the existing test_100_days suite — no real
 * MicroPython firmware, so this is fast and deterministic.
 */

import { describe, it, expect } from 'vitest';
import { Cyw43Emulator, WLC, WLC_E, WLC_E_STATUS } from '../src/cyw43_emulator.js';
import { DEFAULT_AP, formatMac } from '../src/virtual_ap.js';
import { decodeHeader } from '../src/pio_bus_sniffer.js';
import {
  decodeCdc,
  decodeEventBody,
  decodeSdpcm,
  encodeIoctlRequest,
  encodeSdpcm,
} from '../src/sdpcm.js';
import { F0, F1, ClockCsr, SdpcmChannel, TEST_PATTERN } from '../src/cyw43_constants.js';

function f0(opts: { write: boolean; addr: number; length: number }) {
  return decodeHeader(
    (((opts.write ? 1 : 0) << 31) |
      (0 << 28) /* F0 */ |
      ((opts.addr & 0x1ffff) << 11) |
      (opts.length & 0x7ff)) >>>
      0,
  );
}
function f1(opts: { write: boolean; addr: number; length: number }) {
  return decodeHeader(
    (((opts.write ? 1 : 0) << 31) |
      (1 << 28) /* F1 */ |
      ((opts.addr & 0x1ffff) << 11) |
      (opts.length & 0x7ff)) >>>
      0,
  );
}
function f2(opts: { write: boolean; length: number }) {
  return decodeHeader(
    (((opts.write ? 1 : 0) << 31) |
      (1 << 30) /* increment */ |
      (2 << 28) /* F2 */ |
      (opts.length & 0x7ff)) >>>
      0,
  );
}

function readU32(buf: Uint8Array): number {
  return ((buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0);
}

/** Helper that fires an IOCTL and drains every chip→host frame after it. */
function exchange(chip: Cyw43Emulator, sdpcm: Uint8Array): {
  ioctlReply: Uint8Array | null;
  events: Array<{ type: number; status: number; reason: number; data: Uint8Array }>;
} {
  chip.onCommand(f2({ write: true, length: sdpcm.length }), sdpcm);
  let ioctlReply: Uint8Array | null = null;
  const events: Array<{ type: number; status: number; reason: number; data: Uint8Array }> = [];
  for (let i = 0; i < 32; i++) {
    const out = chip.onCommand(f2({ write: false, length: 1600 }), new Uint8Array(0));
    if (!out || out.every((b) => b === 0)) break;
    const f = decodeSdpcm(out);
    if (!f) break;
    if (f.channel === SdpcmChannel.CONTROL) {
      ioctlReply = f.payload;
    } else if (f.channel === SdpcmChannel.EVENT) {
      const ev = decodeEventBody(f.payload);
      if (ev) events.push({ type: ev.eventType, status: ev.status, reason: ev.reason, data: ev.data });
    }
  }
  return { ioctlReply, events };
}

describe('Pico W WiFi — full lifecycle', () => {
  it('completes bus init → scan → connect → packet → disconnect', () => {
    const chip = new Cyw43Emulator();

    // ── 1. Bus init handshake ──────────────────────────────────────
    // First read of F0:0x14 returns 0; second returns FEEDBEAD.
    const r1 = chip.onCommand(f0({ write: false, addr: F0.READ_TEST, length: 4 }), new Uint8Array(0));
    expect(r1).not.toBeNull();
    if (r1) expect(readU32(r1)).toBe(0);

    const r2 = chip.onCommand(f0({ write: false, addr: F0.READ_TEST, length: 4 }), new Uint8Array(0));
    expect(r2).not.toBeNull();
    if (r2) expect(readU32(r2)).toBe(TEST_PATTERN);

    // Set bus control register (driver writes 0x000204b3 typically; we just store).
    chip.onCommand(
      f0({ write: true, addr: F0.BUS_CTRL, length: 4 }),
      new Uint8Array([0xb3, 0x04, 0x02, 0x00]),
    );

    // ── 2. Clock — request HT, expect chip to flip the available bit ──
    chip.onCommand(
      f1({ write: true, addr: F1.SDIO_CHIP_CLOCK_CSR, length: 1 }),
      new Uint8Array([ClockCsr.ALP_AVAIL_REQ | ClockCsr.HT_AVAIL_REQ]),
    );
    const csr = chip.onCommand(f1({ write: false, addr: F1.SDIO_CHIP_CLOCK_CSR, length: 1 }), new Uint8Array(0));
    expect(csr).not.toBeNull();
    if (csr) {
      expect((csr[0] & ClockCsr.HT_AVAIL) !== 0).toBe(true);
      expect((csr[0] & ClockCsr.ALP_AVAIL) !== 0).toBe(true);
    }

    // ── 3. WLC_UP ──────────────────────────────────────────────────
    exchange(chip, encodeIoctlRequest(0, WLC.UP, 0x1, 0, new Uint8Array(0)));
    expect(chip.isUp()).toBe(true);

    // ── 4. SCAN — observe ESCAN_RESULT + SCAN_COMPLETE ─────────────
    let scanFired = false;
    const offScan = chip.onScan((ev) => {
      expect(ev.ap.ssid).toBe('Velxio-GUEST');
      scanFired = true;
    });
    const scanResult = exchange(chip, encodeIoctlRequest(1, WLC.SCAN, 0x1, 0, new Uint8Array(0)));
    offScan();
    expect(scanFired).toBe(true);
    expect(scanResult.events.some((e) => e.type === WLC_E.ESCAN_RESULT)).toBe(true);
    expect(scanResult.events.some((e) => e.type === WLC_E.SCAN_COMPLETE)).toBe(true);

    // ── 5. SET_SSID Velxio-GUEST ─────────────────────────────────
    let connectFired = false;
    const offConnect = chip.onConnect((ev) => {
      expect(ev.ssid).toBe('Velxio-GUEST');
      expect(formatMac(ev.bssid)).toBe(formatMac(DEFAULT_AP.bssid));
      connectFired = true;
    });
    const ssidPayload = new Uint8Array(36);
    const ssid = new TextEncoder().encode('Velxio-GUEST');
    new DataView(ssidPayload.buffer).setUint32(0, ssid.length, true);
    ssidPayload.set(ssid, 4);
    const setSsidResult = exchange(
      chip,
      encodeIoctlRequest(2, WLC.SET_SSID, 0x1, 0, ssidPayload),
    );
    offConnect();

    expect(connectFired).toBe(true);
    expect(chip.getLinkState()).toBe('up');

    // 6. WLC_E_LINK with status=0 reason=1 (link-up flag)
    const linkUp = setSsidResult.events.find(
      (e) => e.type === WLC_E.LINK && e.reason === 1,
    );
    expect(linkUp).toBeDefined();

    // 7. WLC_E_SET_SSID success
    expect(setSsidResult.events.some(
      (e) => e.type === WLC_E.SET_SSID && e.status === WLC_E_STATUS.SUCCESS,
    )).toBe(true);

    // ── 8. GET_BSSID returns the AP BSSID ──────────────────────────
    const bssidReply = exchange(
      chip,
      encodeIoctlRequest(3, WLC.GET_BSSID, 0x0, 6, new Uint8Array(0)),
    );
    expect(bssidReply.ioctlReply).not.toBeNull();
    if (bssidReply.ioctlReply) {
      const cdc = decodeCdc(bssidReply.ioctlReply);
      expect(cdc).not.toBeNull();
      if (cdc) {
        const bssid = cdc.payload.slice(0, 6);
        expect(formatMac(bssid)).toBe(formatMac(DEFAULT_AP.bssid));
      }
    }

    // ── 9. Outbound Ethernet frame fires onPacketOut ───────────────
    const outboundEvents: Uint8Array[] = [];
    chip.onPacketOut((ev) => outboundEvents.push(ev.ether));
    const ether = new Uint8Array([
      // dst: broadcast
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      // src: chip MAC
      0x02, 0x42, 0xda, 0x00, 0x00, 0x42,
      // ethertype: IPv4
      0x08, 0x00,
      // payload (synthetic IP packet — the emulator only forwards bytes)
      0x45, 0x00, 0x00, 0x14, 0xab, 0xcd,
    ]);
    // Driver puts a 4-byte BDC header before the Ethernet frame on data channel.
    const bdc = new Uint8Array([0, 0, 0, 0]);
    const dataPayload = new Uint8Array(bdc.length + ether.length);
    dataPayload.set(bdc); dataPayload.set(ether, bdc.length);
    const dataFrame = encodeSdpcm({
      channel: SdpcmChannel.DATA,
      sequence: 9,
      payload: dataPayload,
    });
    chip.onCommand(f2({ write: true, length: dataFrame.length }), dataFrame);
    expect(outboundEvents).toHaveLength(1);
    expect(Array.from(outboundEvents[0])).toEqual(Array.from(ether));

    // ── 10. Inbound frame from the network → host reads from F2 ────
    chip.injectPacket(new Uint8Array([
      // dst: chip MAC
      0x02, 0x42, 0xda, 0x00, 0x00, 0x42,
      // src: AP
      0x02, 0x42, 0xda, 0x42, 0x00, 0x01,
      // ethertype IPv4
      0x08, 0x00,
      // synthetic payload
      0x45, 0x00, 0x00, 0x14, 0x12, 0x34,
    ]));
    const inboundOut = chip.onCommand(f2({ write: false, length: 1600 }), new Uint8Array(0));
    expect(inboundOut).not.toBeNull();
    if (inboundOut) {
      const f = decodeSdpcm(inboundOut);
      expect(f).not.toBeNull();
      if (f) expect(f.channel).toBe(SdpcmChannel.DATA);
    }

    // ── 11. WLC_DOWN → events drain to link-down ──────────────────
    let disconnectFired = false;
    chip.onDisconnect(() => { disconnectFired = true; });
    const downResult = exchange(chip, encodeIoctlRequest(4, WLC.DOWN, 0x1, 0, new Uint8Array(0)));
    expect(disconnectFired).toBe(true);
    expect(chip.isUp()).toBe(false);
    expect(chip.getLinkState()).toBe('down');
    expect(downResult.events.some(
      (e) => e.type === WLC_E.LINK && e.reason === 0,
    )).toBe(true);
  });

  it('rejects an unknown SSID — link stays down, SET_SSID event reports FAIL', () => {
    const chip = new Cyw43Emulator();
    exchange(chip, encodeIoctlRequest(0, WLC.UP, 0x1, 0, new Uint8Array(0)));

    const ssidPayload = new Uint8Array(36);
    const ssid = new TextEncoder().encode('Some-Other-SSID');
    new DataView(ssidPayload.buffer).setUint32(0, ssid.length, true);
    ssidPayload.set(ssid, 4);
    const r = exchange(
      chip,
      encodeIoctlRequest(1, WLC.SET_SSID, 0x1, 0, ssidPayload),
    );
    expect(chip.getLinkState()).toBe('down');
    const setSsid = r.events.find((e) => e.type === WLC_E.SET_SSID);
    expect(setSsid).toBeDefined();
    if (setSsid) expect(setSsid.status).toBe(WLC_E_STATUS.FAIL);
  });

  it('absorbs a 224 KB firmware stream then continues to serve IOCTLs', () => {
    const chip = new Cyw43Emulator();
    // Stream 224 KB of zeros via F1 with auto-increment, simulating
    // the real driver's firmware load.
    for (let i = 0; i < 224 * 1024; i += 64) {
      chip.onCommand(f1({ write: true, addr: 0, length: 64 }), new Uint8Array(64));
    }
    // Chip should still answer IOCTLs after the firmware stream.
    exchange(chip, encodeIoctlRequest(0, WLC.UP, 0x1, 0, new Uint8Array(0)));
    expect(chip.isUp()).toBe(true);
  });
});
