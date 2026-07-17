/**
 * Cyw43Bridge
 *
 * Manages the WebSocket connection from the frontend to the backend
 * picow_net_bridge for one Pico W board instance. Mirrors Esp32Bridge
 * deliberately — same protocol shape, same lifecycle — so the rest of
 * the frontend (settings UI, status banners, etc.) doesn't need a
 * second mental model.
 *
 * Protocol (JSON frames over /api/simulation/ws/<id>):
 *   Frontend → Backend
 *     { type: 'start_picow',         data: { wifi_enabled: bool } }
 *     { type: 'stop_picow' }
 *     { type: 'picow_packet_out',    data: { ether_b64: string } }
 *
 *   Backend → Frontend
 *     { type: 'wifi_status',         data: { status, ssid?, ip? } }
 *     { type: 'picow_packet_in',     data: { ether_b64: string } }
 *     { type: 'system',              data: { event: string, ... } }
 *     { type: 'error',               data: { message: string } }
 *
 * The chip-side gSPI emulation (Cyw43Emulator) lives entirely in the
 * frontend. Cyw43Bridge only carries Ethernet frames (and a coarse
 * status channel) between the emulator and the host network.
 */

import { getTabSessionId } from '../Esp32Bridge';
import { getEngineUrl } from '../../services/engineConfig';

export interface WifiStatus {
  status: string;
  ssid?: string;
  ip?: string;
}

export interface PacketOutFrame { ether: Uint8Array; }
export interface PacketInFrame { ether: Uint8Array; }

const API_BASE = (): string => {
  // The desktop shell injects the sidecar URL at runtime (random port) via
  // window.__CIRCUIT_MUSE_API_BASE__; honor it first so the QEMU-board WebSocket
  // reaches the local Python sidecar instead of the build-time / dev
  // default. Without this, ESP32 / Pi / STM32 simulations never start in
  // the desktop app (the WS dialed localhost:8001, not the sidecar port).
  if (typeof window !== 'undefined') {
    const injected = (window as { __CIRCUIT_MUSE_API_BASE__?: string }).__CIRCUIT_MUSE_API_BASE__;
    if (typeof injected === 'string' && injected) {
      return injected.replace(/\/+$/, '');
    }
  }
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? getEngineUrl() + '/api';
};

export class Cyw43Bridge {
  readonly boardId: string;

  /** When false the backend never opens a slirp NIC — bridge becomes a no-op. */
  wifiEnabled = false;

  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onWifiStatus: ((s: WifiStatus) => void) | null = null;
  /** Fires when the backend (slirp) has a frame to deliver to the chip. */
  onPacketIn: ((p: PacketInFrame) => void) | null = null;

  private socket: WebSocket | null = null;
  private _connected = false;

  constructor(boardId: string) {
    this.boardId = boardId;
  }

  get connected(): boolean { return this._connected; }
  get clientId(): string { return getTabSessionId() + '::' + this.boardId; }

  connect(): void {
    if (!this.wifiEnabled) return; // user opted out — pure local emulation
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

    const base = API_BASE();
    const wsProtocol = base.startsWith('https') ? 'wss:' : 'ws:';
    const wsUrl =
      base.replace(/^https?:/, wsProtocol) +
      `/simulation/ws/${encodeURIComponent(this.clientId)}`;

    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.onConnected?.();
      this._send({
        type: 'start_picow',
        data: { wifi_enabled: this.wifiEnabled },
      });
    };

    socket.onmessage = (event: MessageEvent) => {
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'wifi_status':
          this.onWifiStatus?.(msg.data as unknown as WifiStatus);
          break;
        case 'picow_packet_in': {
          const b64 = msg.data.ether_b64 as string;
          if (typeof b64 !== 'string') break;
          this.onPacketIn?.({ ether: base64ToBytes(b64) });
          break;
        }
        case 'error':
          this.onError?.(String(msg.data.message ?? 'unknown error'));
          break;
      }
    };

    socket.onclose = () => {
      this._connected = false;
      this.onDisconnected?.();
    };
    socket.onerror = () => {
      this.onError?.('Pico W bridge WebSocket error');
    };
  }

  disconnect(): void {
    if (!this.socket) return;
    try {
      this._send({ type: 'stop_picow', data: {} });
    } catch { /* fall through */ }
    this.socket.close();
    this.socket = null;
    this._connected = false;
  }

  /** Relay an outbound Ethernet frame from the chip to the host network. */
  sendPacket(ether: Uint8Array): void {
    if (!this._connected) return;
    this._send({
      type: 'picow_packet_out',
      data: { ether_b64: bytesToBase64(ether) },
    });
  }

  private _send(msg: { type: string; data: Record<string, unknown> }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }
}

// ── tiny base64 helpers — browser btoa/atob in TextEncoder land ──────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa !== 'undefined'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
