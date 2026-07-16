/**
 * BoardHarness — assembles a multi-chip "board" for CPU integration tests.
 *
 * The runtime in test_custom_chips/src/ exposes:
 *   - PinManager  (numeric pin IDs, edge callbacks)
 *   - ChipInstance.create({ wasm, pinManager, wires, attrs, simNanos })
 *   - chip.tickTimers(nowNanos)
 *
 * For CPU work we want to talk in *named nets* ("A0", "D7", "RD") and
 * have multiple chips share the same net by both registering against it.
 * BoardHarness owns:
 *   - A name → numeric-pin-id map (one numeric ID per net)
 *   - A simulated clock (nanoseconds) advanced by advanceNanos()
 *   - A list of chips so we can tick all timers at once
 *
 * The harness imports the upstream ChipRuntime/PinManager directly. We
 * deliberately do NOT vendor a copy — staying lockstep with the canonical
 * runtime is more important than self-containment.
 */
import { ChipInstance } from '../../test_custom_chips/src/ChipRuntime.js';
import { PinManager }   from '../../test_custom_chips/src/PinManager.js';
import { loadChipWasm } from './helpers.js';

const FIRST_NET_ID = 1000;

export class BoardHarness {
  constructor() {
    this.pm = new PinManager();
    this.chips = [];
    this.nowNanos = 0n;
    this._netIds = new Map();
    this._nextNetId = FIRST_NET_ID;
    this._busListeners = [];
  }

  /** Get (or allocate) the numeric pin ID for a named net. */
  net(name) {
    if (!this._netIds.has(name)) {
      this._netIds.set(name, this._nextNetId++);
    }
    return this._netIds.get(name);
  }

  /** Build a Map<pinName,netId> for ChipInstance.create's `wires` option. */
  wires(pinToNet) {
    const m = new Map();
    for (const [pin, netName] of Object.entries(pinToNet)) {
      m.set(pin, this.net(netName));
    }
    return m;
  }

  /**
   * Instantiate and start a chip. `pinToNet` maps the chip's pin names
   * (the strings it passes to vx_pin_register) to the board's net names.
   */
  async addChip(chipName, pinToNet, opts = {}) {
    const chip = await ChipInstance.create({
      wasm: loadChipWasm(chipName),
      pinManager: this.pm,
      wires: this.wires(pinToNet),
      attrs: opts.attrs ?? new Map(),
      simNanos: () => this.nowNanos,
    });
    chip.start();
    this.chips.push(chip);
    return chip;
  }

  /** Advance simulated time by `nanos` ns and tick every chip's timers. */
  advanceNanos(nanos) {
    this.nowNanos += BigInt(nanos);
    for (const chip of this.chips) chip.tickTimers(this.nowNanos);
  }

  /** Convenience: advance by `n` cycles of period `periodNanos`. */
  clock(n, periodNanos) {
    for (let i = 0; i < n; i++) this.advanceNanos(periodNanos);
  }

  setNet(name, value)  { this.pm.triggerPinChange(this.net(name), Boolean(value)); }
  getNet(name)         { return this.pm.getPinState(this.net(name)); }
  /** PinManager invokes listeners with (pin, state). Wrap so callers see
      the more natural (state) signature for nets they already named. */
  watchNet(name, cb)   { this.pm.onPinChange(this.net(name), (_pin, state) => cb(state)); }

  /** Drive a wide bus (e.g. setBus("A", 16, 0xC000) drives A0..A15). */
  setBus(prefix, width, value) {
    for (let i = 0; i < width; i++) {
      this.pm.triggerPinChange(this.net(`${prefix}${i}`), Boolean((value >> i) & 1));
    }
  }

  /** Read a wide bus as an integer (LSB = pin 0). */
  readBus(prefix, width) {
    let v = 0;
    for (let i = 0; i < width; i++) {
      if (this.pm.getPinState(this.net(`${prefix}${i}`))) v |= (1 << i);
    }
    return v;
  }

  /**
   * Install a software-only ROM that responds to the CPU's bus protocol
   * without compiling a separate chip per test program. The CPU drives
   * address pins + RD̅ (and optionally CS̅); when RD̅ falls, this watcher
   * reads the address bus and drives the data bus with `program[addr]`.
   *
   * Defaults match the 8080/Z80 family:
   *   - 16-bit address bus on A0..A15
   *   - 8-bit  data bus    on D0..D7
   *   - RD̅ is active-low (asserted = false)
   *
   * For 8086 minimum-mode multiplexed AD bus, write a custom variant
   * that demuxes via ALE.
   */
  installFakeRom(program, opts = {}) {
    const {
      addrPrefix = 'A', addrWidth = 16,
      dataPrefix = 'D', dataWidth = 8,
      rd = 'RD',   rdActiveLow = true,
      cs = null,   csActiveLow = true,
      baseAddr = 0,
    } = opts;

    const isAsserted = (level, activeLow) => activeLow ? level === false : level === true;

    const drive = (byte) => {
      for (let i = 0; i < dataWidth; i++) {
        this.pm.triggerPinChange(this.net(`${dataPrefix}${i}`), Boolean((byte >> i) & 1));
      }
    };

    const release = () => {
      for (let i = 0; i < dataWidth; i++) {
        this.pm.triggerPinChange(this.net(`${dataPrefix}${i}`), false);
      }
    };

    this.pm.onPinChange(this.net(rd), (_pin, newLevel) => {
      const reading = isAsserted(newLevel, rdActiveLow);
      const csOk = !cs || isAsserted(this.getNet(cs), csActiveLow);
      if (!reading || !csOk) {
        // Released or chip not selected — tristate (don't fight other drivers).
        return;
      }
      const addr = this.readBus(addrPrefix, addrWidth);
      const offset = addr - baseAddr;
      // Address out of our range → tristate (let another chip drive).
      if (offset < 0 || offset >= program.length) return;
      drive(program[offset] & 0xff);
    });
  }

  /**
   * Install a software-only RAM. Like installFakeRom but also handles
   * write cycles (drive D, assert WR̅ → harness latches into mem[]).
   */
  installFakeRam(sizeBytes, opts = {}) {
    const {
      addrPrefix = 'A', addrWidth = 16,
      dataPrefix = 'D', dataWidth = 8,
      rd = 'RD', rdActiveLow = true,
      wr = 'WR',
      cs = null,
      baseAddr = 0,
    } = opts;
    const mem = new Uint8Array(sizeBytes);

    const driveData = (byte) => {
      for (let i = 0; i < dataWidth; i++) {
        this.pm.triggerPinChange(this.net(`${dataPrefix}${i}`), Boolean((byte >> i) & 1));
      }
    };

    const inRange = (addr) => addr >= baseAddr && addr < baseAddr + sizeBytes;
    const csOk = () => cs === null || this.getNet(cs) === false;
    const rdAsserted = (level) => rdActiveLow ? level === false : level === true;

    this.pm.onPinChange(this.net(rd), (_pin, level) => {
      if (!rdAsserted(level) || !csOk()) return;
      const addr = this.readBus(addrPrefix, addrWidth);
      if (!inRange(addr)) return;   // tristate when address outside our range
      driveData(mem[addr - baseAddr]);
    });

    this.pm.onPinChange(this.net(wr), (_pin, level) => {
      // Latch on rising edge of WR̅ release (i.e. WR̅ goes from 0→1) — that's
      // when real DRAM/SRAM samples data. CPUs typically guarantee data is
      // stable for a setup time before WR̅ deasserts.
      if (level !== true || !csOk()) return;
      const addr = this.readBus(addrPrefix, addrWidth);
      if (!inRange(addr)) return;
      const byte = this.readBus(dataPrefix, dataWidth);
      mem[addr - baseAddr] = byte & 0xff;
    });

    return {
      mem,
      peek: (a) => mem[a - baseAddr],
      poke: (a, v) => { mem[a - baseAddr] = v & 0xff; },
    };
  }

  /**
   * Install a fake 8086-bus ROM/RAM that handles the multiplexed AD
   * protocol with ALE-driven address latching, exactly as a real 8086
   * minimum-mode board does. The chip drives:
   *   T1: AD0..AD15 = addr_low; A16..A19 = addr_high; ALE pulse.
   *   T2..T4 (read): chip releases AD; asserts RD̅; we drive AD with
   *     data; chip samples on byte boundaries (even addr → AD0..AD7,
   *     odd addr → AD8..AD15).
   *   T2..T4 (write): chip drives AD with data; asserts WR̅; we latch
   *     on rising edge of WR̅.
   *
   * Returns { mem, peek, poke } where mem is an internal array indexed
   * by physical address (size depends on `opts.size`).
   */
  installFake8086Bus(opts = {}) {
    const {
      size = 0x100000,        /* 1 MB by default */
      ramRange = [0x00000, 0x80000],   /* writable region */
      rom = null,             /* optional Uint8Array placed at romBase */
      romBase = 0xF0000,
    } = opts;
    const mem = new Uint8Array(size);
    if (rom) {
      for (let i = 0; i < rom.length && (romBase + i) < size; i++) {
        mem[romBase + i] = rom[i];
      }
    }

    let latchedAddr = 0;

    const inWritable = (a) => a >= ramRange[0] && a < ramRange[1];

    const driveByteOnAD = (byte, addr) => {
      if (addr & 1) {
        for (let i = 0; i < 8; i++) {
          this.pm.triggerPinChange(this.net(`AD${i+8}`), Boolean((byte >> i) & 1));
        }
      } else {
        for (let i = 0; i < 8; i++) {
          this.pm.triggerPinChange(this.net(`AD${i}`), Boolean((byte >> i) & 1));
        }
      }
    };

    /* Latch address on ALE rising. */
    this.pm.onPinChange(this.net('ALE'), (_pin, level) => {
      if (level !== true) return;
      let lo = 0, hi = 0;
      for (let i = 0; i < 16; i++) if (this.getNet(`AD${i}`)) lo |= (1 << i);
      for (let i = 16; i < 20; i++) if (this.getNet(`A${i}`)) hi |= (1 << (i - 16));
      latchedAddr = (hi << 16) | lo;
    });

    /* Read response on RD̅ falling. */
    this.pm.onPinChange(this.net('RD'), (_pin, level) => {
      if (level !== false) return;
      const addr = latchedAddr & (size - 1);
      driveByteOnAD(mem[addr], addr);
    });

    /* Write latch on WR̅ rising. */
    this.pm.onPinChange(this.net('WR'), (_pin, level) => {
      if (level !== true) return;
      const addr = latchedAddr & (size - 1);
      if (!inWritable(addr)) return;
      let byte = 0;
      if (addr & 1) {
        for (let i = 0; i < 8; i++) if (this.getNet(`AD${i+8}`)) byte |= (1 << i);
      } else {
        for (let i = 0; i < 8; i++) if (this.getNet(`AD${i}`)) byte |= (1 << i);
      }
      mem[addr] = byte;
    });

    return {
      mem,
      peek: (a) => mem[a & (size - 1)],
      poke: (a, v) => { mem[a & (size - 1)] = v & 0xff; },
    };
  }

  /**
   * Capture every (addr, data) pair the CPU writes via WR̅. Useful for
   * asserting the *sequence* of writes, not just final state.
   */
  captureWrites(opts = {}) {
    const { addrPrefix = 'A', addrWidth = 16,
            dataPrefix = 'D', dataWidth = 8, wr = 'WR' } = opts;
    const log = [];
    this.pm.onPinChange(this.net(wr), (_pin, level) => {
      if (level !== true) return;
      log.push({
        addr: this.readBus(addrPrefix, addrWidth),
        data: this.readBus(dataPrefix, dataWidth),
        atNanos: this.nowNanos,
      });
    });
    return log;
  }

  /** Pulse RESET̅ low for a few simulated nanoseconds, then high. */
  pulseReset(opts = {}) {
    const { name = 'RESET', activeLow = true, holdNanos = 100, periodNanos = 250 } = opts;
    this.setNet(name, activeLow ? false : true);
    this.advanceNanos(holdNanos);
    this.setNet(name, activeLow ? true : false);
    this.advanceNanos(periodNanos);
  }

  /** Run until `predicate(board)` is true or we exceed `maxCycles` clock ticks. */
  runUntil(predicate, opts = {}) {
    const { maxCycles = 100000, periodNanos = 500 } = opts;
    for (let i = 0; i < maxCycles; i++) {
      if (predicate(this)) return i;
      this.advanceNanos(periodNanos);
    }
    throw new Error(`runUntil: predicate never true after ${maxCycles} cycles`);
  }

  dispose() {
    for (const chip of this.chips) chip.dispose();
    this.pm.clearAllListeners?.();
  }
}
