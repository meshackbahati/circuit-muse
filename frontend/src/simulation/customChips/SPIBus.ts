/**
 * SPIBus — virtual SPI bus for custom chips.
 *
 * Each chip with vx_spi_attach() registers a SPIDevice. The active slave is
 * the one that has a pending transfer (set up via vx_spi_start()) — typically
 * gated by the chip's own CS pin watch.
 *
 * In the MVP, this bus is *not* connected to the AVR's SPI master peripheral
 * — that integration requires hooking avr8js AVRSPI which behaves differently
 * from AVRTWI. For now, tests/chip-to-chip flows can drive the bus via
 * `transferByte`. AVR-driven SPI is a phase-2 follow-up.
 */

export class SPIDevice {
  private _pending: {
    buffer: Uint8Array;
    count: number;
    position: number;
    onDone: (buffer: Uint8Array, count: number) => void;
  } | null = null;

  startTransfer(
    buffer: Uint8Array,
    count: number,
    onDone: (buffer: Uint8Array, count: number) => void,
  ): void {
    this._pending = { buffer, count, position: 0, onDone };
  }

  stopTransfer(): void {
    const t = this._pending;
    if (!t) return;
    this._pending = null;
    t.onDone(t.buffer, t.position);
  }

  hasPendingTransfer(): boolean {
    return this._pending !== null;
  }

  transfer(masterByte: number): number {
    const t = this._pending;
    if (!t) return 0xff;
    const slaveByte = t.buffer[t.position];
    t.buffer[t.position] = masterByte & 0xff;
    t.position++;
    if (t.position >= t.count) {
      const buf = t.buffer;
      const cnt = t.count;
      const cb = t.onDone;
      this._pending = null;
      cb(buf, cnt);
    }
    return slaveByte;
  }
}

export class SPIBus {
  private devices = new Set<SPIDevice>();

  addDevice(dev: SPIDevice): void {
    this.devices.add(dev);
  }

  removeDevice(dev: SPIDevice): void {
    this.devices.delete(dev);
  }

  /** Transfer one byte. Returns the active slave's response on MISO. */
  transferByte(masterByte: number): number {
    for (const d of this.devices) {
      if (d.hasPendingTransfer()) return d.transfer(masterByte);
    }
    return 0xff;
  }

  transferBytes(bytes: number[]): number[] {
    const out: number[] = [];
    for (const b of bytes) out.push(this.transferByte(b));
    return out;
  }
}
