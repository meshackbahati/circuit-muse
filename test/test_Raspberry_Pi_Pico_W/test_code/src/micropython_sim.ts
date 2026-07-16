/**
 * micropython_sim
 *
 * Tiny harness that drives the Cyw43Emulator with the same byte
 * sequences MicroPython's `network` module emits when a user script
 * does:
 *
 *     wlan = network.WLAN(network.STA_IF)
 *     wlan.active(True)               → WLC_UP
 *     wlan.connect(ssid, password)    → SET_AUTH / SET_VAR wsec_pmk /
 *                                       SET_INFRA / SET_BSSID / SET_SSID
 *     wlan.isconnected()              → polls for WLC_E_LINK reason=1
 *     wlan.ifconfig()                 → returns the synthetic STA IP
 *     wlan.scan()                     → WLC_SCAN, returns parsed SSIDs
 *     socket.socket().send(buf)       → raw Ethernet frame on F2
 *     socket.recv()                   → drains injected frames
 *     wlan.disconnect()               → WLC_DISASSOC
 *
 * This is the bridge between high-level Python code and the gSPI bus.
 * In production, MicroPython's compiled CYW43 driver does the same
 * thing — we substitute it here so we can validate behaviour without
 * spinning up a full MicroPython VM in CI.
 */

import {
  AUTH_TYPE,
  SdpcmChannel,
  WLC,
  WLC_E,
  WLC_E_STATUS,
} from './cyw43_constants.js';
import { Cyw43Emulator } from './cyw43_emulator.js';
import { decodeHeader } from './pio_bus_sniffer.js';
import {
  decodeCdc,
  decodeEventBody,
  decodeSdpcm,
  encodeIoctlRequest,
  encodeSdpcm,
} from './sdpcm.js';
import {
  DEFAULT_AP,
  DEFAULT_GATEWAY,
  DEFAULT_NETMASK,
  DEFAULT_DNS,
  DEFAULT_STA_IP,
  type VirtualAp,
} from './virtual_ap.js';

export interface IfConfig {
  ip: string;
  netmask: string;
  gateway: string;
  dns: string;
}

export interface ScanResult {
  ssid: string;
  bssid: Uint8Array;
  channel: number;
  rssi: number;
  secured: boolean;
}

export interface ConnectResult {
  ok: boolean;
  reason?: string;
}

export interface CapturedEvent {
  type: number;
  status: number;
  reason: number;
  data: Uint8Array;
}

/** Driver simulator. Owns the IOCTL request-id counter and a small inbound queue. */
export class MicroPythonSim {
  private chip: Cyw43Emulator;
  private requestId = 0;
  private connected = false;
  private active = false;

  /** Last events the chip emitted but the script hasn't drained yet. */
  events: CapturedEvent[] = [];
  /** Inbound Ethernet frames (chip → host on F2 channel 2). */
  inbound: Uint8Array[] = [];

  constructor(chip: Cyw43Emulator) {
    this.chip = chip;
  }

  // ── Bus init ──────────────────────────────────────────────────────
  /**
   * Reproduce the bring-up sequence cyw43_ll_bus_init() walks through.
   * Idempotent — running it twice does nothing wrong.
   */
  busInit(): void {
    // 1. Poll F0:0x14 until 0xFEEDBEAD. The chip returns 0 on the very
    // first read and the magic on every read after that.
    this.read(0, 0x14, 4);
    this.read(0, 0x14, 4);
    // 2. Write F0:0x00 = 0x000204b3 (32-bit / LE / high speed).
    this.write(0, 0x00, new Uint8Array([0xb3, 0x04, 0x02, 0x00]));
    // 3. Request HT clock and confirm.
    this.write(1, 0x1000e, new Uint8Array([0x18])); // ALP_AVAIL_REQ | HT_AVAIL_REQ
    this.read(1, 0x1000e, 1);
  }

  // ── network.WLAN ──────────────────────────────────────────────────
  active_(state: boolean): void {
    this.active = state;
    this.ioctl(state ? WLC.UP : WLC.DOWN, new Uint8Array(0), 0);
  }

  /** Mirrors MicroPython's wlan.connect(ssid, password). */
  connect(ssid: string, password: string): ConnectResult {
    if (!this.active) return { ok: false, reason: 'wlan not active' };

    // The MP CYW43 driver issues these in order:
    //   SET_INFRA(1)         → managed STA mode
    //   SET_AUTH(open|wpa2)  → 0 if no password, 6 if WPA2-PSK
    //   SET_VAR wsec_pmk     → passphrase (when secured)
    //   SET_SSID             → kicks off the join state machine
    this.ioctl(WLC.SET_INFRA, le32(1), 1);
    const auth = password ? AUTH_TYPE.WPA2_PSK : AUTH_TYPE.OPEN;
    this.ioctl(WLC.SET_AUTH, le32(auth), 1);
    if (password) {
      const name = enc('wsec_pmk\0');
      // wsec_pmk_t = { uint16 key_len; uint16 flags; uint8 key[64]; }
      const buf = new Uint8Array(name.length + 4 + 64);
      buf.set(name);
      const dv = new DataView(buf.buffer, name.length);
      dv.setUint16(0, password.length, true);
      dv.setUint16(2, 0x0001, true); // WSEC_PASSPHRASE
      buf.set(enc(password).subarray(0, 64), name.length + 4);
      this.ioctl(WLC.SET_VAR, buf, 1);
    }
    const ssidPayload = new Uint8Array(36);
    new DataView(ssidPayload.buffer).setUint32(0, ssid.length, true);
    ssidPayload.set(enc(ssid).subarray(0, 32), 4);
    this.ioctl(WLC.SET_SSID, ssidPayload, 1);

    // Drain emitted events to discover whether the join succeeded.
    const linkUp = this.events.find(
      (e) => e.type === WLC_E.LINK && e.status === WLC_E_STATUS.SUCCESS && e.reason === 1,
    );
    const setSsidFail = this.events.find(
      (e) => e.type === WLC_E.SET_SSID && e.status === WLC_E_STATUS.FAIL,
    );

    if (linkUp) {
      this.connected = true;
      return { ok: true };
    }
    return {
      ok: false,
      reason: setSsidFail ? 'ssid not found' : 'join timeout',
    };
  }

  isconnected(): boolean { return this.connected; }

  /** Returns the synthetic IP config the emulator hands out. */
  ifconfig(): IfConfig {
    return {
      ip: this.connected ? DEFAULT_STA_IP : '0.0.0.0',
      netmask: this.connected ? DEFAULT_NETMASK : '0.0.0.0',
      gateway: this.connected ? DEFAULT_GATEWAY : '0.0.0.0',
      dns: this.connected ? DEFAULT_DNS : '0.0.0.0',
    };
  }

  /** wlan.scan() — returns the list of synthetic APs the chip "sees". */
  scan(): ScanResult[] {
    if (!this.active) return [];
    this.ioctl(WLC.SCAN, new Uint8Array(0), 1);
    const escans = this.events.filter((e) => e.type === WLC_E.ESCAN_RESULT);
    const out: ScanResult[] = [];
    for (const ev of escans) {
      // wl_escan_result_t header = 12 bytes; then wl_bss_info_t.
      const off = 12;
      const bssid = ev.data.slice(off + 8, off + 14);
      const channel = ev.data[off + 8 + 6 + 4 + 2 + 1 + 32 + 4 + 16];
      // We just re-derive from the BSS layout we encode in virtual_ap.ts:
      //   ssid_len at off+18, ssid at off+19, channel at off+19+32+4+16
      const ssidLen = ev.data[off + 18];
      const ssid = new TextDecoder().decode(
        ev.data.subarray(off + 19, off + 19 + ssidLen),
      );
      const channelOff = off + 19 + 32 + 4 + 16;
      const ch = ev.data[channelOff];
      const rssi = new DataView(ev.data.buffer, ev.data.byteOffset).getInt16(
        channelOff + 2 + 1, // after channel(2) + atim_window(2) + dtim_period(1)
        true,
      );
      out.push({
        ssid,
        bssid: new Uint8Array(bssid),
        channel: ch || channel || 0,
        rssi,
        secured: false,
      });
    }
    return out;
  }

  /** wlan.disconnect(). */
  disconnect(): void {
    this.ioctl(WLC.DISASSOC, new Uint8Array(0), 1);
    this.connected = false;
  }

  // ── socket / network I/O ─────────────────────────────────────────

  /** Send a raw Ethernet frame as if `socket.send` had crossed lwIP. */
  sendEthernet(ether: Uint8Array): void {
    const bdc = new Uint8Array(4); // Broadcom data-channel header — 4 zero bytes is fine
    const payload = new Uint8Array(bdc.length + ether.length);
    payload.set(bdc); payload.set(ether, bdc.length);
    const sdpcm = encodeSdpcm({
      channel: SdpcmChannel.DATA,
      sequence: 0,
      payload,
    });
    this.chip.onCommand(this.f2hdr(true, sdpcm.length), sdpcm);
  }

  /** Pull every queued chip→host frame so the inbound[] array reflects current state. */
  drainInbound(): void {
    for (let i = 0; i < 32; i++) {
      const out = this.chip.onCommand(this.f2hdr(false, 1600), new Uint8Array(0));
      if (!out || out.every((b) => b === 0)) break;
      const f = decodeSdpcm(out);
      if (!f) break;
      if (f.channel === SdpcmChannel.DATA) {
        this.inbound.push(f.payload);
      } else if (f.channel === SdpcmChannel.EVENT) {
        const ev = decodeEventBody(f.payload);
        if (ev) this.events.push({
          type: ev.eventType, status: ev.status, reason: ev.reason, data: ev.data,
        });
      }
      // Control frames are IOCTL replies — ioctl() drains those itself.
    }
  }

  // ── private helpers ──────────────────────────────────────────────

  /** Run an IOCTL synchronously, draining the chip's reply + events. */
  private ioctl(cmd: number, payload: Uint8Array, isSet: number): {
    status: number;
    data: Uint8Array;
  } {
    const flags = ((this.requestId++ & 0xffff) << 16) | (isSet & 1);
    const sdpcm = encodeIoctlRequest(0, cmd, flags, payload.length, payload);
    this.chip.onCommand(this.f2hdr(true, sdpcm.length), sdpcm);

    let status = 0;
    let data = new Uint8Array(0);
    for (let i = 0; i < 32; i++) {
      const out = this.chip.onCommand(this.f2hdr(false, 1600), new Uint8Array(0));
      if (!out || out.every((b) => b === 0)) break;
      const f = decodeSdpcm(out);
      if (!f) break;
      if (f.channel === SdpcmChannel.CONTROL) {
        const cdc = decodeCdc(f.payload);
        if (cdc && cdc.cmd === cmd) {
          status = cdc.status;
          data = cdc.payload.slice(0, cdc.outlen);
        }
      } else if (f.channel === SdpcmChannel.EVENT) {
        const ev = decodeEventBody(f.payload);
        if (ev) this.events.push({
          type: ev.eventType, status: ev.status, reason: ev.reason, data: ev.data,
        });
      } else if (f.channel === SdpcmChannel.DATA) {
        this.inbound.push(f.payload);
      }
    }
    return { status, data };
  }

  private read(func: 0 | 1 | 2, addr: number, length: number): Uint8Array {
    return this.chip.onCommand(
      decodeHeader(makeHdrWord({ write: false, func, addr, length })),
      new Uint8Array(0),
    ) ?? new Uint8Array(0);
  }
  private write(func: 0 | 1 | 2, addr: number, payload: Uint8Array): void {
    this.chip.onCommand(
      decodeHeader(makeHdrWord({ write: true, func, addr, length: payload.length })),
      payload,
    );
  }
  private f2hdr(write: boolean, length: number) {
    return decodeHeader(makeHdrWord({ write, func: 2, addr: 0, length, increment: true }));
  }
}

function makeHdrWord(opts: {
  write: boolean;
  func: 0 | 1 | 2;
  addr: number;
  length: number;
  increment?: boolean;
}): number {
  return (
    (((opts.write ? 1 : 0) << 31) |
      ((opts.increment ? 1 : 0) << 30) |
      (opts.func << 28) |
      ((opts.addr & 0x1ffff) << 11) |
      (opts.length & 0x7ff)) >>>
    0
  );
}

function le32(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v >>> 0, true);
  return out;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
