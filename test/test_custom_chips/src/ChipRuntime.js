/**
 * ChipRuntime — Loads a Velxio custom-chip WASM, wires its imports to the
 * host services (PinManager, I2CBus, attribute storage, timer queue), and
 * dispatches its callbacks back into the simulator.
 *
 * Each ChipInstance owns:
 *   - its own WebAssembly.Memory
 *   - its own WebAssembly.Instance
 *   - its own logical-pin → real-arduino-pin wiring map
 *   - its own attribute and timer registries
 *
 * Lifecycle:
 *   const inst = await ChipInstance.create({ wasm, pinManager, i2cBus, wires, attrs, simNanos });
 *   inst.start();   // calls chip_setup
 *   ... simulation runs ...
 *   inst.tickTimers(now);
 *   inst.dispose();
 */

import { WasiShim } from './WasiShim.js';
import { SPIDevice } from './SPIBus.js';

/** Decode a NUL-terminated C string from linear memory. */
function readCString(memory, ptr) {
  const u8 = new Uint8Array(memory.buffer);
  let end = ptr;
  while (end < u8.length && u8[end] !== 0) end++;
  return new TextDecoder().decode(u8.subarray(ptr, end));
}

/**
 * Layouts must match velxio-chip.h. Static asserts in the header guard them
 * on the chip side; the test `04_runtime_imports` verifies the host side.
 *
 * vx_i2c_config: 64 bytes (with reserved[8]).
 */
function readI2CConfig(memory, ptr) {
  const dv = new DataView(memory.buffer);
  return {
    address:    dv.getUint8(ptr + 0),
    scl:        dv.getInt32(ptr + 4,  true),
    sda:        dv.getInt32(ptr + 8,  true),
    on_connect: dv.getUint32(ptr + 12, true),
    on_read:    dv.getUint32(ptr + 16, true),
    on_write:   dv.getUint32(ptr + 20, true),
    on_stop:    dv.getUint32(ptr + 24, true),
    user_data:  dv.getUint32(ptr + 28, true),
  };
}

/** vx_uart_config: 56 bytes (with reserved[8]). */
function readUartConfig(memory, ptr) {
  const dv = new DataView(memory.buffer);
  return {
    rx:         dv.getInt32(ptr + 0,  true),
    tx:         dv.getInt32(ptr + 4,  true),
    baud_rate:  dv.getUint32(ptr + 8, true),
    on_rx_byte: dv.getUint32(ptr + 12, true),
    on_tx_done: dv.getUint32(ptr + 16, true),
    user_data:  dv.getUint32(ptr + 20, true),
  };
}

/** vx_spi_config: 60 bytes (with reserved[8]). */
function readSpiConfig(memory, ptr) {
  const dv = new DataView(memory.buffer);
  return {
    sck:       dv.getInt32(ptr + 0,  true),
    mosi:      dv.getInt32(ptr + 4,  true),
    miso:      dv.getInt32(ptr + 8,  true),
    cs:        dv.getInt32(ptr + 12, true),
    mode:      dv.getUint32(ptr + 16, true),
    on_done:   dv.getUint32(ptr + 20, true),
    user_data: dv.getUint32(ptr + 24, true),
  };
}

export class ChipInstance {
  /**
   * @param {object} opts
   * @param {WebAssembly.Module|ArrayBuffer|Uint8Array} opts.wasm
   * @param {import('./PinManager.js').PinManager} opts.pinManager
   * @param {import('./I2CBus.js').I2CBus|null} [opts.i2cBus]
   * @param {Map<string, number>} [opts.wires]  logical pin name → arduino pin number
   * @param {Map<string, number>} [opts.attrs]  attribute name → numeric value
   * @param {() => bigint | number} [opts.simNanos]
   * @param {(text: string) => void} [opts.log]
   */
  static async create(opts) {
    const inst = new ChipInstance(opts);
    await inst._instantiate();
    return inst;
  }

  constructor({ wasm, pinManager, i2cBus = null, spiBus = null, wires = new Map(), attrs = new Map(), simNanos, log }) {
    this.wasm = wasm;
    this.pinManager = pinManager;
    this.i2cBus = i2cBus;
    this.spiBus = spiBus;
    this.wires = wires;
    this.attrs = attrs;

    // Per-instance state
    this.memory = null;
    this.instance = null;
    this.exports = null;
    this.disposed = false;

    // Logical pin registry: handle → { name, mode, arduinoPin|null }
    this.pins = [];
    // Attribute registry: handle → { name, default }
    this.attrHandles = [];
    // Per-pin watch unsubscribers (keyed by chip-pin handle)
    this._pinWatches = new Map();
    // Timer queue
    this.timers = [];
    // UART devices
    this.uarts = [];
    // Listener that receives bytes the chip writes via uart_write
    this._uartTxListener = null;
    // SPI devices (each is an SPIDevice + bookkeeping)
    this.spiDevices = [];

    // WASI shim — `log` is forwarded as-is. WasiShim already prefixes its
    // own writes via writeStdout, so we don't double-prefix here.
    this.wasi = new WasiShim(
      simNanos ?? (() => 0n),
      log ?? ((s) => process.stdout.write(s)),
    );

    // Build the import object for the chip API.
    this._velxioImports = this._buildVelxioImports();
  }

  async _instantiate() {
    this.memory = new WebAssembly.Memory({ initial: 2, maximum: 16 });
    this.wasi.setMemory(this.memory);

    const importObject = {
      env: {
        memory: this.memory,
        ...this._velxioImports,
      },
      ...this.wasi.imports(),
    };

    let module;
    if (this.wasm instanceof WebAssembly.Module) {
      module = this.wasm;
    } else {
      module = await WebAssembly.compile(this.wasm);
    }

    // Strip imports we don't provide so we can give a clean error.
    const expected = WebAssembly.Module.imports(module);
    const missing = [];
    for (const imp of expected) {
      const ns = importObject[imp.module];
      if (!ns || ns[imp.name] === undefined) {
        missing.push(`${imp.module}.${imp.name}`);
      }
    }
    if (missing.length) {
      throw new Error(
        `Chip WASM imports missing in host:\n  - ${missing.join('\n  - ')}\n` +
          `If these are WASI calls, extend WasiShim. If they're chip API, extend ChipRuntime.`,
      );
    }

    this.instance = await WebAssembly.instantiate(module, importObject);
    this.exports = this.instance.exports;
  }

  /** Run the chip's `chip_setup` once. */
  start() {
    if (!this.exports.chip_setup) {
      throw new Error('Chip WASM does not export chip_setup');
    }
    this.exports.chip_setup();
    this.wasi.flush();
  }

  /**
   * Drive timer callbacks whose deadline has arrived.
   * Should be called periodically from the simulator step loop.
   * @param {bigint|number} nowNanos
   */
  tickTimers(nowNanos) {
    const now = BigInt(nowNanos);
    const table = this.exports.__indirect_function_table;
    if (!table) return;
    for (const t of this.timers) {
      if (!t.active) continue;
      while (t.active && now >= t.nextFire) {
        const fn = table.get(t.cbIdx);
        try { fn(t.userData); } catch (e) { /* noop */ }
        if (t.repeat) {
          t.nextFire += t.period;
        } else {
          t.active = false;
        }
      }
    }
    this.wasi.flush();
  }

  dispose() {
    if (this.disposed) return;
    for (const set of this._pinWatches.values()) {
      for (const u of set) u();
    }
    this._pinWatches.clear();
    this.timers = [];
    if (this.i2cBus && this._i2cAddress != null) {
      this.i2cBus.removeDevice(this._i2cAddress);
    }
    if (this.spiBus) {
      for (const d of this.spiDevices) this.spiBus.removeDevice(d.device);
    }
    this.spiDevices = [];
    this.disposed = true;
  }

  // ── velxio-chip imports ──────────────────────────────────────────────────

  _buildVelxioImports() {
    return {
      // Pins
      vx_pin_register:    (namePtr, mode) => this._pin_register(namePtr, mode),
      vx_pin_read:        (handle) => this._pin_read(handle),
      vx_pin_write:       (handle, value) => this._pin_write(handle, value),
      vx_pin_read_analog: (handle) => this._pin_read_analog(handle),
      vx_pin_dac_write:   (handle, voltage) => this._pin_dac_write(handle, voltage),
      vx_pin_set_mode:    (handle, mode) => this._pin_mode(handle, mode),
      vx_pin_watch:       (handle, edge, cbIdx, userData) =>
        this._pin_watch(handle, edge, cbIdx, userData),
      vx_pin_watch_stop:  (handle) => this._pin_watch_stop(handle),

      // Attributes
      vx_attr_register: (namePtr, defaultVal) => this._attr_register(namePtr, defaultVal),
      vx_attr_read:     (handle) => this._attr_read(handle),

      // I2C
      vx_i2c_attach: (cfgPtr) => this._i2c_attach(cfgPtr),

      // UART
      vx_uart_attach: (cfgPtr) => this._uart_attach(cfgPtr),
      vx_uart_write:  (handle, bufPtr, count) => this._uart_write(handle, bufPtr, count),

      // SPI
      vx_spi_attach: (cfgPtr) => this._spi_attach(cfgPtr),
      vx_spi_start:  (handle, bufPtr, count) => this._spi_start(handle, bufPtr, count),
      vx_spi_stop:   (handle) => this._spi_stop(handle),

      // Time + timers
      vx_sim_now_nanos: () => BigInt(this.wasi.simNanos()),
      vx_timer_create:  (cbIdx, userData) => this._timer_create(cbIdx, userData),
      vx_timer_start:   (handle, period, repeat) => this._timer_start(handle, period, repeat),
      vx_timer_stop:    (handle) => this._timer_stop(handle),

      // Logging
      vx_log: (msgPtr) => {
        const msg = readCString(this.memory, msgPtr);
        this.wasi.writeStdout(`[chip] ${msg}\n`);
      },
    };
  }

  // ── Pin implementations ──────────────────────────────────────────────────

  /** Pin mode constants — must match velxio-chip.h. */
  static MODE_OUTPUT_LOW = 16;
  static MODE_OUTPUT_HIGH = 17;

  _pin_register(namePtr, mode) {
    const name = readCString(this.memory, namePtr);
    const handle = this.pins.length;
    const arduinoPin = this.wires.has(name) ? this.wires.get(name) : null;
    this.pins.push({ name, mode, arduinoPin });
    // Initialize the wired PinManager pin if the mode requires a starting level.
    if (arduinoPin != null) {
      if (mode === ChipInstance.MODE_OUTPUT_LOW)  this.pinManager.triggerPinChange(arduinoPin, false);
      if (mode === ChipInstance.MODE_OUTPUT_HIGH) this.pinManager.triggerPinChange(arduinoPin, true);
    }
    return handle;
  }

  _pin_read(handle) {
    const p = this.pins[handle];
    if (!p || p.arduinoPin == null) return 0;
    return this.pinManager.getPinState(p.arduinoPin) ? 1 : 0;
  }

  _pin_write(handle, value) {
    const p = this.pins[handle];
    if (!p || p.arduinoPin == null) return;
    this.pinManager.triggerPinChange(p.arduinoPin, value !== 0);
  }

  _pin_read_analog(handle) {
    const p = this.pins[handle];
    if (!p || p.arduinoPin == null) return 0.0;
    return this.pinManager.getPwmValue(p.arduinoPin) * 5.0;
  }

  _pin_dac_write(handle, voltage) {
    const p = this.pins[handle];
    if (!p || p.arduinoPin == null) return;
    // Drive an analog voltage on the pin; route through PinManager.setAnalogVoltage
    // which existing tests/components subscribe to via onAnalogChange.
    this.pinManager.setAnalogVoltage(p.arduinoPin, voltage);
  }

  _pin_mode(handle, mode) {
    const p = this.pins[handle];
    if (!p) return;
    p.mode = mode;
    if (p.arduinoPin != null) {
      if (mode === ChipInstance.MODE_OUTPUT_LOW)  this.pinManager.triggerPinChange(p.arduinoPin, false);
      if (mode === ChipInstance.MODE_OUTPUT_HIGH) this.pinManager.triggerPinChange(p.arduinoPin, true);
    }
  }

  _pin_watch(handle, edge, cbIdx, userData) {
    const p = this.pins[handle];
    if (!p || p.arduinoPin == null) return;
    let lastState = this.pinManager.getPinState(p.arduinoPin) ? 1 : 0;
    const unsub = this.pinManager.onPinChange(p.arduinoPin, (_pin, state) => {
      const newState = state ? 1 : 0;
      const isRising = lastState === 0 && newState === 1;
      const isFalling = lastState === 1 && newState === 0;
      lastState = newState;
      const wantRising  = (edge & 1) !== 0;
      const wantFalling = (edge & 2) !== 0;
      if ((isRising && wantRising) || (isFalling && wantFalling)) {
        const table = this.exports.__indirect_function_table;
        if (!table) return;
        const fn = table.get(cbIdx);
        try { fn(userData, handle, newState); } catch (e) { /* swallow chip errors */ }
        this.wasi.flush();
      }
    });
    if (!this._pinWatches.has(handle)) this._pinWatches.set(handle, new Set());
    this._pinWatches.get(handle).add(unsub);
  }

  _pin_watch_stop(handle) {
    const set = this._pinWatches.get(handle);
    if (!set) return;
    for (const u of set) u();
    this._pinWatches.delete(handle);
  }

  // ── Attributes ───────────────────────────────────────────────────────────

  _attr_register(namePtr, defaultVal) {
    const name = readCString(this.memory, namePtr);
    const handle = this.attrHandles.length;
    this.attrHandles.push({ name, default: defaultVal });
    if (!this.attrs.has(name)) this.attrs.set(name, defaultVal);
    return handle;
  }

  _attr_read(handle) {
    const a = this.attrHandles[handle];
    if (!a) return 0.0;
    return this.attrs.get(a.name) ?? a.default;
  }

  // ── I2C ──────────────────────────────────────────────────────────────────

  _i2c_attach(cfgPtr) {
    if (!this.i2cBus) {
      throw new Error('Chip called vx_i2c_attach but no I2CBus is wired to the host');
    }
    const cfg = readI2CConfig(this.memory, cfgPtr);
    const table = this.exports.__indirect_function_table;
    const callFn = (idx, ...args) => {
      const fn = table.get(idx);
      try { return fn(...args); } catch (e) { return 0; }
    };

    const device = {
      address: cfg.address,
      writeByte: (value) => {
        if (cfg.on_connect && this._i2cConnectPending) {
          // Fire on_connect before the first write of a transaction.
          callFn(cfg.on_connect, cfg.user_data, cfg.address, 0);
          this._i2cConnectPending = false;
        }
        const ack = callFn(cfg.on_write, cfg.user_data, value);
        this.wasi.flush();
        return !!ack;
      },
      readByte: () => {
        if (cfg.on_connect && this._i2cConnectPending) {
          callFn(cfg.on_connect, cfg.user_data, cfg.address, 1);
          this._i2cConnectPending = false;
        }
        const b = callFn(cfg.on_read, cfg.user_data) & 0xff;
        this.wasi.flush();
        return b;
      },
      stop: () => {
        if (cfg.on_stop) callFn(cfg.on_stop, cfg.user_data);
        this._i2cConnectPending = true;
        this.wasi.flush();
      },
    };

    // Mark "next op begins a transaction" so on_connect fires once at the boundary.
    this._i2cConnectPending = true;
    this.i2cBus.addDevice(device);
    this._i2cAddress = cfg.address;
    return 0; // handle (only one I2C per chip in MVP)
  }

  // ── SPI ──────────────────────────────────────────────────────────────────

  _spi_attach(cfgPtr) {
    if (!this.spiBus) {
      throw new Error('Chip called vx_spi_attach but no SPIBus is wired to the host');
    }
    const cfg = readSpiConfig(this.memory, cfgPtr);
    const handle = this.spiDevices.length;

    const device = new SPIDevice();
    const onDoneCallback = (buffer, count) => {
      if (cfg.on_done) {
        const table = this.exports.__indirect_function_table;
        const fn = table.get(cfg.on_done);
        // The buffer pointer was passed in; call back with original ptr + count.
        try { fn(cfg.user_data, this._currentSpiBufPtr ?? 0, count); } catch (_) { /* noop */ }
        this.wasi.flush();
      }
    };

    this.spiDevices.push({ device, cfg, onDoneCallback });
    this.spiBus.addDevice(device);
    return handle;
  }

  _spi_start(handle, bufPtr, count) {
    const entry = this.spiDevices[handle];
    if (!entry) return;
    // Live view into WASM memory at the chip's buffer address.
    const buf = new Uint8Array(this.memory.buffer, bufPtr, count);
    this._currentSpiBufPtr = bufPtr;
    entry.device.startTransfer(buf, count, (b, c) => entry.onDoneCallback(b, c));
  }

  _spi_stop(handle) {
    const entry = this.spiDevices[handle];
    if (!entry) return;
    entry.device.stopTransfer();
  }

  // ── UART ─────────────────────────────────────────────────────────────────

  _uart_attach(cfgPtr) {
    const cfg = readUartConfig(this.memory, cfgPtr);
    const handle = this.uarts.length;
    this.uarts.push(cfg);
    return handle;
  }

  _uart_write(handle, bufPtr, count) {
    const u = this.uarts[handle];
    if (!u) return 0;
    const u8 = new Uint8Array(this.memory.buffer);
    const bytes = u8.slice(bufPtr, bufPtr + count);
    if (this._uartTxListener) {
      for (const b of bytes) this._uartTxListener(b);
    }
    // Notify the chip that the write completed (synchronous in our sim).
    if (u.on_tx_done) {
      const table = this.exports.__indirect_function_table;
      const fn = table.get(u.on_tx_done);
      try { fn(u.user_data); } catch (_) { /* noop */ }
    }
    this.wasi.flush();
    return 1;
  }

  /**
   * Push a received byte into the chip's UART (simulates a byte arriving
   * on the chip's RX pin). Triggers the chip's on_rx_byte callback.
   */
  feedUart(byte, handle = 0) {
    const u = this.uarts[handle];
    if (!u || !u.on_rx_byte) return;
    const table = this.exports.__indirect_function_table;
    const fn = table.get(u.on_rx_byte);
    try { fn(u.user_data, byte & 0xff); } catch (_) { /* noop */ }
    this.wasi.flush();
  }

  /** Register a listener for bytes the chip emits via uart_write. */
  onUartTx(cb) {
    this._uartTxListener = cb;
  }

  // ── Timers ───────────────────────────────────────────────────────────────

  _timer_create(cbIdx, userData) {
    const handle = this.timers.length;
    this.timers.push({ cbIdx, userData, active: false, period: 0n, nextFire: 0n, repeat: false });
    return handle;
  }

  _timer_start(handle, periodNanos, repeat) {
    const t = this.timers[handle];
    if (!t) return;
    t.period = BigInt(periodNanos);
    t.repeat = !!repeat;
    t.nextFire = BigInt(this.wasi.simNanos()) + t.period;
    t.active = true;
  }

  _timer_stop(handle) {
    const t = this.timers[handle];
    if (t) t.active = false;
  }
}
