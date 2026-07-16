/**
 * cyw43_emulator
 *
 * Full CYW43439 chip-side emulator — supersedes cyw43_emulator_tier0.
 * Everything in here is derived from public sources:
 *   - Infineon CYW43439 datasheet
 *   - pico-sdk pico_cyw43_driver  (BSD-3)
 *   - jbentham/picowi             (MIT — third-party/picowi/LICENSE)
 *   - georgerobotics/cyw43-driver (read-only reference, not copied)
 *
 * The chip's real ARM core inside the package is NOT executed — this
 * is a behavioural model on the gSPI bus side. See the autosearch
 * dossier ../autosearch/04_emulation_design.md for the rationale.
 *
 * Capability map relative to the design tiers:
 *
 *   Tier 0  ✅  — handshake, F0/F1 register state, gpioout LED IOCTL
 *   Tier 1  ✅  — full IOCTL surface (UP/DOWN/SET_INFRA/SET_AUTH/…),
 *                 SDPCM event injection, scan returns Velxio-GUEST,
 *                 SET_SSID drives the link state machine
 *   Tier 2  🟡  — outbound Ethernet frames on F2 fire ``onPacketOut``;
 *                 inbound packets accepted via ``injectPacket``. The
 *                 caller is expected to plumb these to a host TCP/UDP
 *                 sink (in production: backend WS bridge mirroring
 *                 backend/app/services/esp32_worker.py).
 *
 * Tier 3 (real BT, monitor mode, WPA3 SAE) is intentionally out of
 * scope.
 */

import {
  AUTH_TYPE,
  ClockCsr,
  F0,
  F1,
  SdpcmChannel,
  TEST_PATTERN,
  WLC,
  WLC_E,
  WLC_E_STATUS,
  u32le,
} from './cyw43_constants.js';
import {
  CDC_HEADER_LEN,
  decodeCdc,
  decodeSdpcm,
  encodeEventFrame,
  encodeIoctlRequest,
  encodeSdpcm,
} from './sdpcm.js';
import {
  bssInfoBlob,
  DEFAULT_AP,
  DEFAULT_STA_MAC,
  type VirtualAp,
} from './virtual_ap.js';
import type { Cyw43Cmd } from './pio_bus_sniffer.js';

// ── Public event surface ────────────────────────────────────────────

export type LinkState = 'down' | 'authenticating' | 'up';

export interface LedEvent { on: boolean; t: number; }
export interface ScanEvent { ap: VirtualAp; t: number; }
export interface ConnectEvent { ssid: string; bssid: Uint8Array; t: number; }
export interface DisconnectEvent { reason: number; t: number; }
export interface PacketOutEvent {
  /** Raw Ethernet frame the host wanted to transmit (incl. dest+src+ethertype). */
  ether: Uint8Array;
  /** Sequence number from the SDPCM frame, for ordering. */
  sequence: number;
  t: number;
}

export interface Cyw43EmulatorOptions {
  /** Override the AP that scan() returns. Defaults to Velxio-GUEST. */
  ap?: VirtualAp;
  /** Override the STA MAC the chip reports. */
  staMac?: Uint8Array;
  /** Optional clock for tests. */
  now?: () => number;
}

type Listener<T> = (ev: T) => void;

export class Cyw43Emulator {
  private bootMs: number;
  private now: () => number;

  // ── Bus state ────────────────────────────────────────────────────
  private f0Regs = new Uint32Array(16);
  private clockCsr = ClockCsr.ALP_AVAIL;
  private readTestPrimed = false;
  private f1Window = 0;
  private chipReady = false;

  // ── Sequence counters (host expects monotonic) ──────────────────
  private hostToChipSeq = 0;
  private chipToHostSeq = 0;

  // ── WiFi state ──────────────────────────────────────────────────
  private linkState: LinkState = 'down';
  private wlcUp = false;
  private currentSsid = '';
  private staMac: Uint8Array;
  private ap: VirtualAp;
  private eventMask = new Uint8Array(32); // up to 256 event types
  private inboundEvents: Uint8Array[] = [];

  // ── Listeners ───────────────────────────────────────────────────
  private ledListeners: Listener<LedEvent>[] = [];
  private scanListeners: Listener<ScanEvent>[] = [];
  private connectListeners: Listener<ConnectEvent>[] = [];
  private disconnectListeners: Listener<DisconnectEvent>[] = [];
  private packetOutListeners: Listener<PacketOutEvent>[] = [];

  constructor(opts: Cyw43EmulatorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.bootMs = this.now();
    this.ap = opts.ap ?? DEFAULT_AP;
    this.staMac = opts.staMac ?? DEFAULT_STA_MAC;
    // F2 ready at boot — driver tolerates this being true early.
    this.f0Regs[F0.F2_INFO >> 2] = 0x01;
  }

  // ── Listener registration ───────────────────────────────────────
  onLed = (cb: Listener<LedEvent>) => this.add(this.ledListeners, cb);
  onScan = (cb: Listener<ScanEvent>) => this.add(this.scanListeners, cb);
  onConnect = (cb: Listener<ConnectEvent>) => this.add(this.connectListeners, cb);
  onDisconnect = (cb: Listener<DisconnectEvent>) => this.add(this.disconnectListeners, cb);
  onPacketOut = (cb: Listener<PacketOutEvent>) => this.add(this.packetOutListeners, cb);

  private add<T>(arr: Listener<T>[], cb: Listener<T>): () => void {
    arr.push(cb);
    return () => {
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /** Sequence-stamped milliseconds-since-boot for events. */
  private t(): number { return this.now() - this.bootMs; }

  /** Inspectors used by tests. */
  isUp(): boolean { return this.wlcUp; }
  getLinkState(): LinkState { return this.linkState; }
  getStaMac(): Uint8Array { return this.staMac; }

  // ── Bus entry point ─────────────────────────────────────────────

  /**
   * Apply a gSPI command observed on the wire. For WR commands the
   * payload carries data the driver wrote; for RD commands the chip
   * returns a Uint8Array of length ``cmd.length``.
   */
  onCommand(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (cmd.function === 0) return this.handleF0(cmd, payload);
    if (cmd.function === 1) return this.handleF1(cmd, payload);
    if (cmd.function === 2) return this.handleF2(cmd, payload);
    return cmd.write ? null : new Uint8Array(cmd.length);
  }

  /**
   * Push an inbound Ethernet frame into the chip → host data path.
   * Production code would call this when the slirp/socket bridge
   * receives bytes destined for the simulated STA's IP address.
   */
  injectPacket(ether: Uint8Array): void {
    const sdpcm = encodeSdpcm({
      channel: SdpcmChannel.DATA,
      sequence: this.chipToHostSeq++ & 0xff,
      payload: ether,
    });
    this.inboundEvents.push(sdpcm);
    // Light up the F2 packet-available bit so the driver polls.
    this.f0Regs[F0.INTERRUPT >> 2] |= 0x40;
  }

  // ── F0: gSPI bus control ────────────────────────────────────────

  private handleF0(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (cmd.write) {
      const word = readU32LE(payload, 0);
      const idx = cmd.address >>> 2;
      if (idx >= 0 && idx < this.f0Regs.length) this.f0Regs[idx] = word;
      if (cmd.address === F0.RESET_BP) this.f1Window = 0;
      // Writing 1s to interrupt register clears (RW1C).
      if (cmd.address === F0.INTERRUPT) {
        this.f0Regs[F0.INTERRUPT >> 2] &= ~word;
      }
      return null;
    }
    const out = new Uint8Array(cmd.length);
    if (cmd.address === F0.READ_TEST) {
      const value = this.readTestPrimed ? TEST_PATTERN : 0;
      this.readTestPrimed = true;
      writeU32LE(out, 0, value);
      this.chipReady = true;
    } else {
      const idx = cmd.address >>> 2;
      if (idx >= 0 && idx < this.f0Regs.length) {
        writeU32LE(out, 0, this.f0Regs[idx]);
      }
    }
    return out;
  }

  // ── F1: backplane window ────────────────────────────────────────

  private handleF1(cmd: Cyw43Cmd, payload: Uint8Array): Uint8Array | null {
    if (cmd.write) {
      if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_LOW) {
        this.f1Window = (this.f1Window & 0xffff00) | (payload[0] ?? 0);
      } else if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_MID) {
        this.f1Window = (this.f1Window & 0xff00ff) | ((payload[0] ?? 0) << 8);
      } else if (cmd.address === F1.SDIO_BACKPLANE_ADDRESS_HIGH) {
        this.f1Window = (this.f1Window & 0x00ffff) | ((payload[0] ?? 0) << 16);
      } else if (cmd.address === F1.SDIO_CHIP_CLOCK_CSR) {
        const requested = payload[0] ?? 0;
        if (requested & ClockCsr.ALP_AVAIL_REQ) this.clockCsr |= ClockCsr.ALP_AVAIL;
        if (requested & ClockCsr.HT_AVAIL_REQ) this.clockCsr |= ClockCsr.HT_AVAIL;
      }
      // Auto-increment window pointer for sequential streaming (firmware,
      // NVRAM, CLM blob). We don't store any of those bytes — the host
      // driver never reads them back.
      if (cmd.increment) this.f1Window += cmd.length;
      return null;
    }

    const out = new Uint8Array(cmd.length);
    if (cmd.address === F1.SDIO_CHIP_CLOCK_CSR) {
      out[0] = this.clockCsr & 0xff;
    } else if (cmd.address === F1.SDIO_INT_STATUS) {
      // Signal "F2 packet available" if we have queued frames for the host.
      if (this.inboundEvents.length > 0) writeU32LE(out, 0, 0x40);
    }
    if (cmd.increment) this.f1Window += cmd.length;
    return out;
  }

  // ── F2: SDPCM frame channel ─────────────────────────────────────

  private handleF2(cmd: Cyw43Cmd, _payload: Uint8Array): Uint8Array | null {
    if (cmd.write) {
      const frame = decodeSdpcm(_payload);
      if (frame) this.handleHostFrame(frame.channel, frame.payload);
      return null;
    }

    // Read: host wants the next chip→host frame. Drain queue.
    if (this.inboundEvents.length === 0) {
      // Clear the interrupt bit since there's nothing left.
      this.f0Regs[F0.INTERRUPT >> 2] &= ~0x40;
      return new Uint8Array(cmd.length);
    }
    const next = this.inboundEvents.shift()!;
    const out = new Uint8Array(cmd.length);
    out.set(next.subarray(0, Math.min(next.length, out.length)));
    if (this.inboundEvents.length === 0) {
      this.f0Regs[F0.INTERRUPT >> 2] &= ~0x40;
    }
    return out;
  }

  // ── Host → chip frame dispatch ──────────────────────────────────

  private handleHostFrame(channel: number, payload: Uint8Array): void {
    if (channel === SdpcmChannel.CONTROL) {
      this.handleIoctl(payload);
    } else if (channel === SdpcmChannel.DATA) {
      // Outbound Ethernet frame. Strip BDC header (4 bytes) if present;
      // for the test harness we forward raw payload.
      const BDC = 4;
      const ether = payload.length >= BDC ? payload.subarray(BDC) : payload;
      this.firePacketOut(ether);
    }
    // Channel 1 (events) is chip → host only.
  }

  // ── IOCTL handler ───────────────────────────────────────────────

  private handleIoctl(cdcBytes: Uint8Array): void {
    const cdc = decodeCdc(cdcBytes);
    if (!cdc) return;
    const isGet = (cdc.flags & 0x1) === 0; // bit 0 clear = GET
    const data = cdc.payload;
    // For SET_VAR/GET_VAR, name is a NUL-terminated string at start of payload.
    let varName = '';
    let varOff = 0;
    if (cdc.cmd === WLC.SET_VAR || cdc.cmd === WLC.GET_VAR) {
      varName = readCString(data, 0);
      varOff = varName.length + 1;
    }
    const reqId = (cdc.flags >>> 16) & 0xffff;
    let response = new Uint8Array(0);
    let status = 0;

    switch (cdc.cmd) {
      case WLC.GET_MAGIC:
        response = u32le(WLC.IOCTL_MAGIC);
        break;
      case WLC.GET_VERSION:
        response = u32le(0x12345001); // synthetic FW version
        break;
      case WLC.UP:
        this.wlcUp = true;
        break;
      case WLC.DOWN:
        this.wlcUp = false;
        if (this.linkState === 'up') {
          this.linkState = 'down';
          this.fireDisconnect(0);
          this.queueEvent(WLC_E.DEAUTH_IND, WLC_E_STATUS.SUCCESS, 0);
          this.queueEvent(WLC_E.LINK, WLC_E_STATUS.SUCCESS, 0); // status=0 = link down
        }
        break;
      case WLC.SET_INFRA:
        // 0 = ad-hoc, 1 = managed (STA). We just record.
        break;
      case WLC.SET_AUTH:
        // 0 = OPEN, others = WPA. We accept everything.
        break;
      case WLC.SET_BSSID:
        // Driver pins the BSSID before SET_SSID; just ack.
        break;
      case WLC.GET_BSSID:
        response = this.linkState === 'up'
          ? new Uint8Array(this.ap.bssid)
          : new Uint8Array(6);
        break;
      case WLC.GET_SSID: {
        const out = new Uint8Array(36);
        const ssid = new TextEncoder().encode(this.currentSsid);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, ssid.length, true);
        out.set(ssid.subarray(0, 32), 4);
        response = out;
        break;
      }
      case WLC.SET_SSID:
        this.handleSetSsid(data);
        break;
      case WLC.SET_CHANNEL:
        // Just ack — channel selection is up to the chip in real life.
        break;
      case WLC.SCAN:
        this.handleScan();
        break;
      case WLC.DISASSOC:
        if (this.linkState !== 'down') {
          this.linkState = 'down';
          this.fireDisconnect(3 /* DEAUTH_LEAVING */);
          this.queueEvent(WLC_E.DISASSOC_IND, WLC_E_STATUS.SUCCESS, 3);
          this.queueEvent(WLC_E.LINK, WLC_E_STATUS.SUCCESS, 0);
        }
        break;
      case WLC.SET_VAR:
        this.handleSetVar(varName, data.subarray(varOff));
        break;
      case WLC.GET_VAR:
        response = this.handleGetVar(varName, cdc.outlen);
        break;
      default:
        // Unknown IOCTL — ack with empty payload, just like the real
        // chip does for many no-op iovars.
        break;
    }

    // Build the IOCTL reply: SDPCM channel 0, CDC with status + payload.
    const replyCdc = new Uint8Array(CDC_HEADER_LEN + response.length);
    const dv = new DataView(replyCdc.buffer);
    dv.setUint32(0, cdc.cmd, true);
    dv.setUint16(4, response.length, true);
    dv.setUint16(6, 0, true);
    // Mirror the request-id in the upper 16 bits, set bit 0 to mark "response"
    dv.setUint32(8, ((reqId & 0xffff) << 16) | (isGet ? 0 : 1), true);
    dv.setUint32(12, status >>> 0, true);
    replyCdc.set(response, CDC_HEADER_LEN);
    const sdpcm = encodeSdpcm({
      channel: SdpcmChannel.CONTROL,
      sequence: this.chipToHostSeq++ & 0xff,
      payload: replyCdc,
    });
    this.inboundEvents.push(sdpcm);
    this.f0Regs[F0.INTERRUPT >> 2] |= 0x40;
  }

  // ── Concrete IOCTL handlers ─────────────────────────────────────

  private handleSetSsid(data: Uint8Array): void {
    if (data.length < 4) return;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ssidLen = Math.min(dv.getUint32(0, true), 32);
    const ssid = new TextDecoder('utf-8').decode(data.subarray(4, 4 + ssidLen));
    this.currentSsid = ssid;
    this.linkState = 'authenticating';

    // Drive the connection state machine asynchronously, in the order a
    // real chip emits events.
    this.queueEvent(WLC_E.JOIN_START, WLC_E_STATUS.SUCCESS, 0);
    this.queueEvent(WLC_E.AUTH, WLC_E_STATUS.SUCCESS, 0);
    this.queueEvent(WLC_E.ASSOC_START, WLC_E_STATUS.SUCCESS, 0);

    if (ssid === this.ap.ssid) {
      this.queueEvent(WLC_E.ASSOC, WLC_E_STATUS.SUCCESS, 0);
      this.queueEvent(WLC_E.SET_SSID, WLC_E_STATUS.SUCCESS, 0,
        encodeSetSsidPayload(ssid));
      this.queueEvent(WLC_E.LINK, WLC_E_STATUS.SUCCESS, 1 /* link up flag */);
      this.linkState = 'up';
      this.fireConnect(ssid);
    } else {
      this.queueEvent(WLC_E.SET_SSID, WLC_E_STATUS.FAIL, 0,
        encodeSetSsidPayload(ssid));
      this.queueEvent(WLC_E.LINK, WLC_E_STATUS.SUCCESS, 0);
      this.linkState = 'down';
    }
  }

  private handleScan(): void {
    // Real chip emits one ESCAN_RESULT per BSS, then SCAN_COMPLETE.
    const bss = bssInfoBlob(this.ap);
    const escanPayload = buildEscanResult(bss);
    this.queueEvent(WLC_E.ESCAN_RESULT, WLC_E_STATUS.SUCCESS, 0, escanPayload);
    this.queueEvent(WLC_E.SCAN_COMPLETE, WLC_E_STATUS.SUCCESS, 0);
    this.fireScan(this.ap);
  }

  private handleSetVar(name: string, value: Uint8Array): void {
    if (name === 'gpioout' && value.length >= 8) {
      const dv = new DataView(value.buffer, value.byteOffset, value.byteLength);
      const mask = dv.getUint32(0, true);
      const val = dv.getUint32(4, true);
      if (mask & 0x1) this.fireLed((val & 0x1) === 0x1);
    }
    // bsscfg:event_msgs payload: 4-byte cfg index + 16-byte mask
    if (name === 'bsscfg:event_msgs' && value.length >= 4 + 16) {
      const mask = value.slice(4, 4 + 16);
      this.eventMask = new Uint8Array(32);
      this.eventMask.set(mask);
    }
    // sup_wpa_psk / wsec_pmk / passphrase — accept silently.
  }

  private handleGetVar(name: string, _outlen: number): Uint8Array {
    if (name === 'cur_etheraddr') {
      return new Uint8Array(this.staMac);
    }
    if (name === 'ver') {
      // Synthetic firmware version banner; the driver only uses the prefix.
      return new TextEncoder().encode('velxio-cyw43-emu 1.0\0');
    }
    return new Uint8Array(0);
  }

  // ── Event queueing ─────────────────────────────────────────────

  private queueEvent(
    eventType: number,
    status: number,
    reason: number,
    payload: Uint8Array = new Uint8Array(0),
  ): void {
    // Honour the host's event mask if it's been set; events outside the
    // mask are dropped on the floor (the chip wouldn't deliver them).
    if (this.eventMask.length > 0 && eventType < 256) {
      const byteIdx = (eventType >>> 3) & 0x1f;
      const bit = 1 << (eventType & 0x7);
      // Layout matches picowi: first 4 bytes are header, mask starts at
      // byte 4. We accept any non-zero mask byte for the relevant index
      // as "subscribed" — emitting masked events is harmless.
      const masked = (this.eventMask[4 + byteIdx] & bit) !== 0;
      if (!masked && this.hasAnyMaskBitsSet()) return;
    }
    const frame = encodeEventFrame(
      this.chipToHostSeq++ & 0xff,
      eventType,
      status,
      reason,
      payload,
      this.staMac,
    );
    this.inboundEvents.push(frame);
    this.f0Regs[F0.INTERRUPT >> 2] |= 0x40;
  }

  private hasAnyMaskBitsSet(): boolean {
    for (let i = 4; i < this.eventMask.length; i++) {
      if (this.eventMask[i] !== 0) return true;
    }
    return false;
  }

  // ── Listener fan-out ───────────────────────────────────────────

  private fireLed(on: boolean): void {
    const ev: LedEvent = { on, t: this.t() };
    for (const cb of this.ledListeners) safe(cb, ev);
  }
  private fireScan(ap: VirtualAp): void {
    for (const cb of this.scanListeners) safe(cb, { ap, t: this.t() });
  }
  private fireConnect(ssid: string): void {
    for (const cb of this.connectListeners)
      safe(cb, { ssid, bssid: this.ap.bssid, t: this.t() });
  }
  private fireDisconnect(reason: number): void {
    for (const cb of this.disconnectListeners) safe(cb, { reason, t: this.t() });
  }
  private firePacketOut(ether: Uint8Array): void {
    for (const cb of this.packetOutListeners) {
      safe(cb, { ether, sequence: this.hostToChipSeq++ & 0xff, t: this.t() });
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────

function safe<T>(cb: (ev: T) => void, ev: T): void {
  try { cb(ev); } catch { /* harness — never throw across listener */ }
}

function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0);
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

function encodeSetSsidPayload(ssid: string): Uint8Array {
  const ssidBytes = new TextEncoder().encode(ssid);
  const out = new Uint8Array(36);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, ssidBytes.length, true);
  out.set(ssidBytes.subarray(0, 32), 4);
  return out;
}

function buildEscanResult(bss: Uint8Array): Uint8Array {
  // wl_escan_result_t = { uint32 buflen; uint32 version; uint16 sync_id;
  //                       uint16 bss_count; wl_bss_info_t bss_info[]; }
  const headerLen = 12;
  const out = new Uint8Array(headerLen + bss.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length, true);
  dv.setUint32(4, 109, true);
  dv.setUint16(8, 1, true);  // sync_id
  dv.setUint16(10, 1, true); // bss_count
  out.set(bss, headerLen);
  return out;
}

// Re-exports for tests
export { AUTH_TYPE, WLC, WLC_E, WLC_E_STATUS };
