/**
 * WasiShim — minimal WASI implementation for Velxio custom chips.
 *
 * Implements just the syscalls wasi-libc invokes from the typical chip code
 * path (printf, exit, clock_time_get). Everything else returns ENOSYS (28).
 */

const ENOSYS = 28;

export type SimNanosFn = () => bigint | number;
export type WriteStdoutFn = (text: string) => void;

export class WasiShim {
  memory: WebAssembly.Memory | null = null;
  simNanos: SimNanosFn;
  writeStdout: WriteStdoutFn;
  private _stdoutBuf = '';
  private _randCounter = 0;

  constructor(simNanos: SimNanosFn, writeStdout: WriteStdoutFn) {
    this.simNanos = simNanos;
    this.writeStdout = writeStdout;
  }

  setMemory(memory: WebAssembly.Memory): void {
    this.memory = memory;
  }

  private _u8(): Uint8Array {
    return new Uint8Array(this.memory!.buffer);
  }

  private _dv(): DataView {
    return new DataView(this.memory!.buffer);
  }

  // ── Syscalls ─────────────────────────────────────────────────────────────

  fd_write = (fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number => {
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
      let nl: number;
      while ((nl = this._stdoutBuf.indexOf('\n')) !== -1) {
        this.writeStdout(this._stdoutBuf.slice(0, nl + 1));
        this._stdoutBuf = this._stdoutBuf.slice(nl + 1);
      }
    }
    return 0;
  };

  proc_exit = (code: number): never => {
    throw new Error(`chip called proc_exit(${code})`);
  };

  clock_time_get = (_id: number, _precision: bigint, timePtr: number): number => {
    const dv = this._dv();
    const ns = BigInt(this.simNanos() as number | bigint);
    dv.setBigUint64(timePtr, ns, true);
    return 0;
  };

  environ_sizes_get = (countPtr: number, sizePtr: number): number => {
    const dv = this._dv();
    dv.setUint32(countPtr, 0, true);
    dv.setUint32(sizePtr, 0, true);
    return 0;
  };
  environ_get = (): number => 0;
  args_sizes_get = (cPtr: number, sPtr: number): number => {
    const dv = this._dv();
    dv.setUint32(cPtr, 0, true);
    dv.setUint32(sPtr, 0, true);
    return 0;
  };
  args_get = (): number => 0;

  random_get = (ptr: number, len: number): number => {
    const u8 = this._u8();
    for (let i = 0; i < len; i++) {
      this._randCounter = (this._randCounter * 1664525 + 1013904223) >>> 0;
      u8[ptr + i] = this._randCounter & 0xff;
    }
    return 0;
  };

  fd_close = (): number => 0;
  fd_seek = (): number => ENOSYS;
  fd_read = (): number => ENOSYS;
  fd_fdstat_get = (): number => 0;
  fd_prestat_get = (): number => 8;
  fd_prestat_dir_name = (): number => ENOSYS;

  imports(): Record<string, Record<string, (...args: any[]) => any>> {
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
    } as Record<string, (...args: any[]) => any>;
    return {
      wasi_snapshot_preview1: wasi,
      wasi_unstable: wasi,
    };
  }

  flush(): void {
    if (this._stdoutBuf.length > 0) {
      this.writeStdout(this._stdoutBuf);
      this._stdoutBuf = '';
    }
  }
}
