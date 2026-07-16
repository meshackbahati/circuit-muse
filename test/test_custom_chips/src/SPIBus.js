/**
 * SPIBus — virtual SPI bus for custom chips.
 *
 * Each chip with vx_spi_attach() registers a device. The active slave is the
 * one that currently has a pending transfer (set up via vx_spi_start()) — this
 * is typically gated by the chip's own CS pin watch.
 *
 * `transferByte(masterByte)` routes the byte to the active slave and returns
 * its MISO response. A test or AVR-side SPI master uses this to exchange data.
 */
export class SPIDevice {
  constructor() {
    this._pending = null; // { buffer: Uint8Array, count, position, onDone }
  }

  startTransfer(buffer, count, onDone) {
    this._pending = { buffer, count, position: 0, onDone };
  }

  stopTransfer() {
    const t = this._pending;
    if (!t) return;
    this._pending = null;
    // Fire on_done with the bytes received so far (may be < count if aborted).
    t.onDone(t.buffer, t.position);
  }

  hasPendingTransfer() {
    return this._pending !== null;
  }

  transfer(masterByte) {
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
  constructor() {
    this.devices = new Set();
  }

  addDevice(dev) { this.devices.add(dev); }
  removeDevice(dev) { this.devices.delete(dev); }

  /**
   * Transfer one byte on the bus. Returns the byte the active slave drove
   * onto MISO. If no slave has a pending transfer, returns 0xff (idle).
   */
  transferByte(masterByte) {
    for (const d of this.devices) {
      if (d.hasPendingTransfer()) return d.transfer(masterByte);
    }
    return 0xff;
  }

  /** Convenience: transfer a sequence of bytes; returns array of responses. */
  transferBytes(bytes) {
    const out = [];
    for (const b of bytes) out.push(this.transferByte(b));
    return out;
  }
}
