/**
 * Best-effort file logger for Tauri desktop builds.
 *
 * Packaged Tauri apps have no devtools and no stdout capture, so
 * `console.log` vanishes. This helper round-trips messages to a Rust
 * command (`write_debug_log`) that appends them to
 * `<app_data_dir>/desktop-debug.log` — on Windows that's
 * `%APPDATA%\dev.velxio.desktop\desktop-debug.log`. The user (or
 * support) can open the file to see what the webview was doing.
 *
 * The Rust command lives in the velxio-prod overlay, not upstream
 * — the OSS Tauri shell wires it through `pro/desktop/src-tauri/src/
 * lib.rs::write_debug_log`. If the command isn't registered (running
 * an older shell), the log call silently no-ops; we still print to
 * console so devtools / `tauri dev` keep working.
 */

import { invoke, isTauri } from './tauriBridge';

const PREFIX = '[velxio-desktop]';

export function dlog(message: string, extra?: unknown): void {
  // Always echo to console — `tauri dev` (or browser-loaded dev mode)
  // can see this even without the Rust-side file.
  // eslint-disable-next-line no-console
  console.log(PREFIX, message, extra ?? '');
  if (!isTauri()) return;
  let line = message;
  if (extra !== undefined) {
    try {
      line += ' ' + JSON.stringify(extra);
    } catch {
      line += ' ' + String(extra);
    }
  }
  invoke<void>('write_debug_log', { message: line }).catch(() => {
    /* logging must never break the app */
  });
}
