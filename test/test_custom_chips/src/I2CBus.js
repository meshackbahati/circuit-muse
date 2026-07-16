/**
 * I2CBus — JS port of Velxio's frontend/src/simulation/I2CBusManager.ts
 *
 * Implements `TWIEventHandler` from avr8js. Routes I2C bus events from the AVR
 * to virtual slave devices indexed by 7-bit address.
 *
 * Devices implement: { address, writeByte(value)→ack, readByte()→byte, stop?() }
 */

export class I2CBus {
  constructor(twi) {
    this.twi = twi;
    twi.eventHandler = this;
    this.devices = new Map();
    this.activeDevice = null;
    this.writeMode = true;
  }

  addDevice(device) {
    this.devices.set(device.address, device);
  }

  removeDevice(address) {
    this.devices.delete(address);
  }

  // ── TWIEventHandler ─────────────────────────────────────────────────────

  start(_repeated) {
    this.twi.completeStart();
  }

  stop() {
    if (this.activeDevice?.stop) this.activeDevice.stop();
    this.activeDevice = null;
    this.twi.completeStop();
  }

  connectToSlave(addr, write) {
    const device = this.devices.get(addr);
    if (device) {
      this.activeDevice = device;
      this.writeMode = write;
      this.twi.completeConnect(true);
    } else {
      this.activeDevice = null;
      this.twi.completeConnect(false);
    }
  }

  writeByte(value) {
    if (this.activeDevice) {
      const ack = this.activeDevice.writeByte(value);
      this.twi.completeWrite(ack);
    } else {
      this.twi.completeWrite(false);
    }
  }

  readByte(_ack) {
    if (this.activeDevice) {
      const value = this.activeDevice.readByte();
      this.twi.completeRead(value);
    } else {
      this.twi.completeRead(0xff);
    }
  }
}
