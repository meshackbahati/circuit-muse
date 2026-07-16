/**
 * Resolve the base URL of the velxio FastAPI backend at runtime.
 *
 * Two layers of override:
 *
 *   1. `window.__VELXIO_API_BASE__` — set by a thin wrapper that hosts
 *      the SPA against a non-default backend (e.g. the Tauri desktop
 *      shell injects this before the bundle runs, pointing at the
 *      locally spawned Python sidecar on `http://127.0.0.1:<port>`).
 *   2. `import.meta.env.VITE_API_BASE` — set at build time. Used by
 *      bespoke deployments that want a fixed backend URL baked in.
 *   3. Default `/api` — the standard same-origin reverse-proxy setup
 *      that velxio.dev and the OSS Docker image use.
 *
 * Resolved on every call rather than memoised so a host can swap the
 * window var late (e.g. on a sidecar restart). The lookup is cheap.
 */

export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as { __VELXIO_API_BASE__?: string };
    if (typeof w.__VELXIO_API_BASE__ === 'string' && w.__VELXIO_API_BASE__) {
      return w.__VELXIO_API_BASE__.replace(/\/+$/, '');
    }
  }
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (typeof fromEnv === 'string' && fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  return '/api';
}

declare global {
  interface Window {
    __VELXIO_API_BASE__?: string;
  }
}
