/**
 * RaspberryPi3Bridge
 *
 * Manages the WebSocket connection from the frontend to the backend
 * QEMU manager for one Raspberry Pi 3B board instance.
 *
 * Protocol (JSON frames):
 *   Frontend → Backend
 *     { type: 'start_pi', data: { board: 'raspberry-pi-3'|'raspberry-pi-4'|'raspberry-pi-5' } }
 *     { type: 'stop_pi' }
 *     { type: 'serial_input', data: { bytes: number[] } }
 *     { type: 'gpio_in', data: { pin: number, state: 0 | 1 } }
 *     { type: 'pi_attach_slave', data: {
 *         bus_kind: 'i2c'|'spi'|'uart',
 *         bus_num:  number,
 *         address?: number,   // i2c
 *         cs?:      number,   // spi
 *         model_id: string,   // e.g. 'bme280'
 *         config?:  Record<string, unknown>,
 *     }}
 *     { type: 'pi_detach_slave', data: { bus_kind, bus_num, address?|cs? } }
 *
 *   Backend → Frontend
 *     { type: 'serial_output', data: { data: string } }
 *     { type: 'gpio_change',   data: { pin: number, state: 0 | 1 } }
 *     { type: 'system',        data: { event: string, ... } }
 *     { type: 'error',         data: { message: string } }
 */

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

export class RaspberryPi3Bridge {
  readonly boardId: string;
  /** Pi family member: 'raspberry-pi-3' | 'raspberry-pi-4' | 'raspberry-pi-5'.
   * The backend uses this to pick the QEMU -cpu / -m. Defaults to Pi 3 for
   * back-compat with code paths that don't know the kind yet. */
  readonly boardKind: string;

  // Callbacks wired up by useSimulatorStore
  onSerialData: ((char: string) => void) | null = null;
  onPinChange: ((gpioPin: number, state: boolean) => void) | null = null;
  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onSystemEvent: ((event: string, data: Record<string, unknown>) => void) | null = null;

  private socket: WebSocket | null = null;
  private _connected = false;

  constructor(boardId: string, boardKind: string = 'raspberry-pi-3') {
    this.boardId = boardId;
    this.boardKind = boardKind;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

    const base = API_BASE();
    const wsProtocol = base.startsWith('https') ? 'wss:' : 'ws:';
    const wsUrl =
      base.replace(/^https?:/, wsProtocol) + `/simulation/ws/${encodeURIComponent(this.boardId)}`;

    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.onConnected?.();
      // Tell the backend which Pi family member to boot.
      this._send({ type: 'start_pi', data: { board: this.boardKind } });
    };

    socket.onmessage = (event: MessageEvent) => {
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'serial_output': {
          const text = (msg.data.data as string) ?? '';
          if (this.onSerialData) {
            for (const ch of text) this.onSerialData(ch);
          }
          break;
        }
        case 'gpio_change': {
          const pin = msg.data.pin as number;
          const state = (msg.data.state as number) === 1;
          this.onPinChange?.(pin, state);
          break;
        }
        case 'system':
          this.onSystemEvent?.(msg.data.event as string, msg.data);
          break;
        case 'error':
          this.onError?.(msg.data.message as string);
          break;
      }
    };

    socket.onclose = () => {
      this._connected = false;
      this.socket = null;
      this.onDisconnected?.();
    };

    socket.onerror = () => {
      this.onError?.('WebSocket error');
    };
  }

  disconnect(): void {
    if (this.socket) {
      // Tell backend to stop Pi before closing
      this._send({ type: 'stop_pi' });
      this.socket.close();
      this.socket = null;
    }
    this._connected = false;
  }

  /** Send a byte to the Pi's ttyAMA0 (user serial) */
  sendSerialByte(byte: number): void {
    this._send({ type: 'serial_input', data: { bytes: [byte] } });
  }

  /** Send multiple bytes at once */
  sendSerialBytes(bytes: number[]): void {
    if (bytes.length === 0) return;
    this._send({ type: 'serial_input', data: { bytes } });
  }

  /** Drive a GPIO pin from an external source (e.g. connected Arduino) */
  sendPinEvent(gpioPin: number, state: boolean): void {
    this._send({ type: 'gpio_in', data: { pin: gpioPin, state: state ? 1 : 0 } });
  }

  /**
   * Attach an I2C/SPI/UART slave model to the running Pi. The backend
   * pro overlay turns this into a PiSlaveRegistry entry that the
   * protocol dispatcher consults on each guest read. OSS images
   * silently drop the message.
   */
  attachSlave(spec: {
    bus_kind: 'i2c' | 'spi' | 'uart';
    bus_num: number;
    address?: number;
    cs?: number;
    model_id: string;
    config?: Record<string, unknown>;
  }): void {
    this._send({ type: 'pi_attach_slave', data: spec });
  }

  detachSlave(spec: {
    bus_kind: 'i2c' | 'spi' | 'uart';
    bus_num: number;
    address?: number;
    cs?: number;
  }): void {
    this._send({ type: 'pi_detach_slave', data: spec });
  }

  private _send(payload: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
