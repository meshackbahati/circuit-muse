/**
 * UUID v4 generator with a polyfill for non-secure contexts.
 *
 * `crypto.randomUUID()` is only exposed on secure contexts (HTTPS, localhost,
 * 127.0.0.1, ::1). When Velxio is self-hosted and accessed via a LAN IP over
 * plain HTTP (e.g. `http://192.168.31.139:3080/`), `crypto.randomUUID` is
 * `undefined` and any code path that calls it throws `TypeError`. That bug
 * silently broke ESP32 simulation start for self-hosters — frontend never sent
 * the start request because the UUID call rejected before reaching the WS
 * connection.
 *
 * `crypto.getRandomValues()` IS available in non-secure contexts, so we
 * fall back to building a v4 UUID by hand.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
