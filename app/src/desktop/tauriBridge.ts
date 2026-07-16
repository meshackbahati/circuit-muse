/**
 * Thin typed wrapper around the Tauri IPC surface used by the desktop
 * frontend modules. Falls back gracefully when loaded outside Tauri.
 */

export type TauriInvoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type TauriListen = <T = unknown>(
  event: string,
  cb: (payload: { payload: T }) => void,
) => Promise<() => void>;

type TauriGlobal = {
  core?: { invoke?: TauriInvoke };
  invoke?: TauriInvoke;
  event?: { listen?: TauriListen };
};

function tauri(): TauriGlobal | null {
  const w = window as { __TAURI__?: TauriGlobal };
  return w.__TAURI__ ?? null;
}

export function isTauri(): boolean {
  return tauri() !== null;
}

export const invoke: TauriInvoke = async (cmd, args) => {
  const t = tauri();
  if (!t) throw new Error('Tauri runtime not available');
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) throw new Error('Tauri invoke handler not available');
  return fn(cmd, args);
};

export const listen: TauriListen = async (event, cb) => {
  const t = tauri();
  if (!t?.event?.listen) {
    return () => undefined;
  }
  return t.event.listen(event, cb);
};

export async function openExternal(url: string): Promise<void> {
  const t = tauri();

  if (!t) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = t as any;
  const attempts: Array<[string, () => Promise<unknown>]> = [
    ['invoke opener.open_url', () => invoke('plugin:opener|open_url', { url })],
    ['invoke opener.open',     () => invoke('plugin:opener|open_url', { path: url })],
    ['invoke shell.open path', () => invoke('plugin:shell|open', { path: url, with: null })],
    ['invoke shell.open url',  () => invoke('plugin:shell|open', { url })],
    ['shell.open',     () => tg.shell?.open?.(url)],
    ['opener.openUrl', () => tg.opener?.openUrl?.(url)],
    ['opener.open',    () => tg.opener?.open?.(url)],
  ];

  let lastError: unknown = null;
  for (const [name, fn] of attempts) {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        await r;
      } else if (r === undefined) {
        continue;
      }
      tryLog(`openExternal: ${name} succeeded`, { url });
      return;
    } catch (err) {
      lastError = err;
    }
  }

  tryLog('openExternal: every IPC path failed, falling back to window.open', {
    url,
    lastError: lastError ? String(lastError) : null,
  });
  window.open(url, '_blank', 'noopener,noreferrer');
}

function tryLog(message: string, extra?: unknown): void {
  console.log('[circuit-muse-desktop]', message, extra ?? '');
  const t = tauri();
  if (!t) return;
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) return;
  let line = message;
  if (extra !== undefined) {
    try { line += ' ' + JSON.stringify(extra); }
    catch { line += ' ' + String(extra); }
  }
  void (fn as TauriInvoke)('write_debug_log', { message: line }).catch(() => {});
}

export interface SerialPortInfo {
  path: string;
  vid?: number | null;
  pid?: number | null;
  manufacturer?: string | null;
  product?: string | null;
  serial_number?: string | null;
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<SerialPortInfo[]>('list_serial_ports');
  } catch (err) {
    tryLog('listSerialPorts: command failed', { err: String(err) });
    return [];
  }
}

export { tryLog as dlog };
