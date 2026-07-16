/**
 * picow-cyw43-integration.test.ts
 *
 * Verifies the Pico W (CYW43439) frontend integration:
 *   1. The cyw43/ barrel exports a stable surface.
 *   2. Cyw43Bridge speaks the documented WS protocol shape.
 *   3. The Cyw43Emulator accepts the bus init handshake exactly the
 *      way the prototype tests in
 *        test/test_Raspberry_Pi_Pico_W/test_code/
 *      verify it. We re-run a tight subset here so any regression
 *      caught in the frontend tree fails CI close to the offending
 *      change rather than waiting for the prototype suite.
 *
 * Reference upstream IoT projects:
 *   github.com/KritishMohapatra/100_Days_100_IoT_Projects
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Cyw43Emulator,
  Cyw43Bridge,
  DEFAULT_AP,
  DEFAULT_STA_MAC,
  PioBusSniffer,
  TEST_PATTERN,
  WLC,
  WLC_E,
  ClockCsr,
  F0,
  F1,
  SdpcmChannel,
  encodeIoctlRequest,
  decodeSdpcm,
  decodeCdc,
  decodeEventBody,
} from '../simulation/cyw43';
import { decodeHeader } from '../simulation/cyw43/PioBusSniffer';

function makeHdr(opts: {
  write: boolean;
  func: 0 | 1 | 2 | 3;
  addr: number;
  length: number;
  inc?: boolean;
}) {
  return decodeHeader(
    (((opts.write ? 1 : 0) << 31) |
      ((opts.inc ? 1 : 0) << 30) |
      (opts.func << 28) |
      ((opts.addr & 0x1ffff) << 11) |
      (opts.length & 0x7ff)) >>>
      0,
  );
}
function readU32(b: Uint8Array): number {
  return ((b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0);
}

describe('cyw43 barrel exports', () => {
  it('exposes the public surface used by RP2040Simulator', () => {
    expect(Cyw43Emulator).toBeDefined();
    expect(Cyw43Bridge).toBeDefined();
    expect(PioBusSniffer).toBeDefined();
    expect(typeof TEST_PATTERN).toBe('number');
    expect(WLC.GET_MAGIC).toBe(0);
    expect(WLC_E.LINK).toBe(16);
    expect(F0.READ_TEST).toBe(0x14);
    expect(F1.SDIO_CHIP_CLOCK_CSR).toBe(0x1000e);
    expect(SdpcmChannel.CONTROL).toBe(0);
    expect(DEFAULT_AP.ssid).toBe('Velxio-GUEST');
    expect(DEFAULT_STA_MAC.length).toBe(6);
  });
});

describe('Cyw43Emulator bus handshake', () => {
  it('returns 0 then 0xFEEDBEAD on F0:0x14 reads', () => {
    const chip = new Cyw43Emulator();
    const r1 = chip.onCommand(makeHdr({ write: false, func: 0, addr: F0.READ_TEST, length: 4 }), new Uint8Array(0))!;
    const r2 = chip.onCommand(makeHdr({ write: false, func: 0, addr: F0.READ_TEST, length: 4 }), new Uint8Array(0))!;
    expect(readU32(r1)).toBe(0);
    expect(readU32(r2)).toBe(TEST_PATTERN);
  });

  it('flips HT_AVAIL after a HT_AVAIL_REQ write', () => {
    const chip = new Cyw43Emulator();
    chip.onCommand(
      makeHdr({ write: true, func: 1, addr: F1.SDIO_CHIP_CLOCK_CSR, length: 1 }),
      new Uint8Array([ClockCsr.HT_AVAIL_REQ]),
    );
    const r = chip.onCommand(
      makeHdr({ write: false, func: 1, addr: F1.SDIO_CHIP_CLOCK_CSR, length: 1 }),
      new Uint8Array(0),
    )!;
    expect(r[0] & ClockCsr.HT_AVAIL).toBeGreaterThan(0);
  });
});

describe('Cyw43Emulator IOCTL — SET_SSID Velxio-GUEST', () => {
  it('drives the chip to link-up and emits WLC_E_LINK', () => {
    const chip = new Cyw43Emulator();
    // WLC_UP
    pushIoctl(chip, WLC.UP, new Uint8Array(0), 1);
    expect(chip.isUp()).toBe(true);

    // SET_SSID
    const ssid = new TextEncoder().encode('Velxio-GUEST');
    const payload = new Uint8Array(36);
    new DataView(payload.buffer).setUint32(0, ssid.length, true);
    payload.set(ssid, 4);
    const events = pushIoctl(chip, WLC.SET_SSID, payload, 1);

    expect(chip.getLinkState()).toBe('up');
    expect(events.some((e) => e.type === WLC_E.LINK && e.reason === 1)).toBe(true);
    expect(events.some((e) => e.type === WLC_E.SET_SSID && e.status === 0)).toBe(true);
  });
});

describe('Cyw43Bridge WS protocol shape', () => {
  let createdSockets: Array<{
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    onopen?: () => void;
    onmessage?: (e: MessageEvent) => void;
    onclose?: () => void;
    onerror?: () => void;
  }>;

  beforeEach(() => {
    createdSockets = [];
    class FakeSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      send = vi.fn();
      close = vi.fn();
      readyState = 1;
      onopen?: () => void;
      onmessage?: (e: MessageEvent) => void;
      onclose?: () => void;
      onerror?: () => void;
      constructor(_url: string) {
        createdSockets.push(this);
      }
    }
    // @ts-expect-error — we substitute a stub that satisfies the shape we use
    globalThis.WebSocket = FakeSocket;
  });

  it('skips connect() when wifi is disabled', () => {
    const b = new Cyw43Bridge('test-board');
    b.wifiEnabled = false;
    b.connect();
    expect(createdSockets).toHaveLength(0);
  });

  it('opens a WS, sends start_picow, and forwards outbound packets', () => {
    const b = new Cyw43Bridge('test-board');
    b.wifiEnabled = true;
    b.connect();
    expect(createdSockets).toHaveLength(1);
    const sock = createdSockets[0];
    sock.onopen?.();
    expect(sock.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"start_picow"'),
    );
    expect(sock.send).toHaveBeenCalledWith(
      expect.stringContaining('"wifi_enabled":true'),
    );

    b.sendPacket(new Uint8Array([1, 2, 3, 4, 5]));
    const lastCall = sock.send.mock.calls.at(-1)?.[0] as string | undefined;
    expect(lastCall).toContain('"type":"picow_packet_out"');
    expect(lastCall).toContain('"ether_b64"');
  });
});

// ── helper ────────────────────────────────────────────────────────

function pushIoctl(
  chip: Cyw43Emulator,
  cmd: number,
  payload: Uint8Array,
  isSet: number,
): Array<{ type: number; status: number; reason: number; data: Uint8Array }> {
  const sdpcm = encodeIoctlRequest(0, cmd, isSet, 0, payload);
  chip.onCommand(makeHdr({ write: true, func: 2, addr: 0, length: sdpcm.length, inc: true }), sdpcm);
  const events: Array<{ type: number; status: number; reason: number; data: Uint8Array }> = [];
  for (let i = 0; i < 32; i++) {
    const out = chip.onCommand(makeHdr({ write: false, func: 2, addr: 0, length: 1600, inc: true }), new Uint8Array(0))!;
    if (!out || out.every((b) => b === 0)) break;
    const f = decodeSdpcm(out);
    if (!f) break;
    if (f.channel === SdpcmChannel.EVENT) {
      const ev = decodeEventBody(f.payload);
      if (ev) events.push({ type: ev.eventType, status: ev.status, reason: ev.reason, data: ev.data });
    } else if (f.channel === SdpcmChannel.CONTROL) {
      decodeCdc(f.payload); // ignore — we just care about events
    }
  }
  return events;
}
