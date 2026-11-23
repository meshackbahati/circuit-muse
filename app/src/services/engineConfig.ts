/**
 * Engine configuration - auto-detects the engine port.
 */

const ENGINE_PORT_KEY = 'circuit-muse-engine-port';
const DEFAULT_PORT = 8001;
const MAX_PORT = 8100;

let cachedPort: number | null = null;

/**
 * Get the engine API base URL.
 * Checks localStorage first, falls back to default port.
 */
export function getEngineUrl(): string {
  if (cachedPort) return `http://127.0.0.1:${cachedPort}`;

  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(ENGINE_PORT_KEY) : null;
  if (stored) {
    cachedPort = parseInt(stored, 10);
    return `http://127.0.0.1:${cachedPort}`;
  }

  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

/**
 * Set the engine port (called when Tauri reports the actual port).
 */
export function setEnginePort(port: number): void {
  cachedPort = port;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ENGINE_PORT_KEY, String(port));
  }
}

/**
 * Try to find the engine by scanning ports.
 */
export async function detectEnginePort(): Promise<number | null> {
  const ports = Array.from(
    { length: MAX_PORT - DEFAULT_PORT + 1 },
    (_, index) => DEFAULT_PORT + index,
  );
  const results = await Promise.all(
    ports.map(async (port) => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(750),
        });
        return resp.ok ? port : null;
      } catch {
        return null;
      }
    }),
  );
  const port = results.find((result): result is number => result !== null);
  if (port !== undefined) setEnginePort(port);
  return port ?? null;
}

/**
 * Get the WebSocket URL for simulation.
 */
export function getSimulationWsUrl(sessionId: string, boardId: string): string {
  const base = getEngineUrl().replace('http', 'ws');
  return `${base}/api/simulation/ws/${sessionId}::${boardId}`;
}
