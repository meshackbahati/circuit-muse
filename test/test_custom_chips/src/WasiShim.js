/**
 * WasiShim — minimal WASI implementation for Velxio custom chips.
 *
 * Only the syscalls that wasi-libc actually invokes from the typical chip
 * code path are implemented:
 *   - fd_write   (used by printf)
 *   - proc_exit  (used by abort/exit)
 *   - clock_time_get  (rarely used; returns simulated nanos)
 *   - environ_sizes_get / environ_get / args_sizes_get / args_get  (stubs)
 *   - random_get (deterministic counter — chips shouldn't depend on randomness)
 *
 * Everything else returns 28 (ENOSYS).
 */

const ENOSYS = 28;

export class WasiShim {
  /**
   * @param {() => bigint | number} simNanos  Function that returns simulation
   *        time in nanoseconds. Used by clock_time_get.
   * @param {(text: string) => void} writeStdout  Callback for printf output.
   */
  constructor(simNanos, writeStdout) {
    this.memory = null;
    this.simNanos = simNanos ?? (() => 0n);
    this.writeStdout = writeStdout ?? ((s) => process.stdout.write(s));
    this._stdoutBuf = '';
    this._randCounter = 0;
  }

  setMemory(memory) {
    this.memory = memory;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _u8() {
    return new Uint8Array(this.memory.buffer);
  }

  _dv() {
    return new DataView(this.memory.buffer);
  }

  _readBytes(ptr, len) {
    return this._u8().slice(ptr, ptr + len);
  }

  // ── Syscalls ───────────────────────────────────────────────────────────

  /** fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) → errno */
  fd_write = (fd, iovsPtr, iovsLen, nwrittenPtr) => {
    const dv = this._dv();
    const u8 = this._u8();
    let total = 0;
    let chunk = '';
    for (let i = 0; i < iovsLen; i++) {
      const buf = dv.getUint32(iovsPtr + i * 8, true);
      const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
      chunk += new TextDecoder().decode(u8.subarray(buf, buf + len));
      total += len;
    }
    dv.setUint32(nwrittenPtr, total, true);

    if (fd === 1 || fd === 2) {
      this._stdoutBuf += chunk;
      // Emit complete lines so log() with newlines flushes immediately.
      let nl;
      while ((nl = this._stdoutBuf.indexOf('\n')) !== -1) {
        this.writeStdout(this._stdoutBuf.slice(0, nl + 1));
        this._stdoutBuf = this._stdoutBuf.slice(nl + 1);
      }
    }
    return 0;
  };

  proc_exit = (_code) => {
    throw new Error(`chip called proc_exit(${_code})`);
  };

  /**
   * clock_time_get(clock_id, precision, time_ptr) → errno
   * We always return our simulation clock regardless of clock_id.
   */
  clock_time_get = (_id, _precision, timePtr) => {
    const dv = this._dv();
    const ns = BigInt(this.simNanos());
    dv.setBigUint64(timePtr, ns, true);
    return 0;
  };

  environ_sizes_get = (countPtr, sizePtr) => {
    const dv = this._dv();
    dv.setUint32(countPtr, 0, true);
    dv.setUint32(sizePtr, 0, true);
    return 0;
  };
  environ_get = () => 0;
  args_sizes_get = (cPtr, sPtr) => {
    const dv = this._dv();
    dv.setUint32(cPtr, 0, true);
    dv.setUint32(sPtr, 0, true);
    return 0;
  };
  args_get = () => 0;

  random_get = (ptr, len) => {
    const u8 = this._u8();
    for (let i = 0; i < len; i++) {
      this._randCounter = (this._randCounter * 1664525 + 1013904223) >>> 0;
      u8[ptr + i] = this._randCounter & 0xff;
    }
    return 0;
  };

  fd_close = () => 0;
  fd_seek = () => ENOSYS;
  fd_read = () => ENOSYS;
  fd_fdstat_get = () => 0;
  fd_prestat_get = () => 8; // EBADF
  fd_prestat_dir_name = () => ENOSYS;

  /** Returns the import object for `WebAssembly.instantiate`. */
  imports() {
    const wasi = {
      fd_write: this.fd_write,
      proc_exit: this.proc_exit,
      clock_time_get: this.clock_time_get,
      environ_sizes_get: this.environ_sizes_get,
      environ_get: this.environ_get,
      args_sizes_get: this.args_sizes_get,
      args_get: this.args_get,
      random_get: this.random_get,
      fd_close: this.fd_close,
      fd_seek: this.fd_seek,
      fd_read: this.fd_read,
      fd_fdstat_get: this.fd_fdstat_get,
      fd_prestat_get: this.fd_prestat_get,
      fd_prestat_dir_name: this.fd_prestat_dir_name,
    };
    // wasi-libc looks for either preview1 or unstable depending on version.
    return {
      wasi_snapshot_preview1: wasi,
      wasi_unstable: wasi,
    };
  }

  /** Flush any pending stdout that didn't end with a newline. */
  flush() {
    if (this._stdoutBuf.length > 0) {
      this.writeStdout(this._stdoutBuf);
      this._stdoutBuf = '';
    }
  }
}
