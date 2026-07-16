/**
 * cyw43_constants
 *
 * CYW43439 register addresses, IOCTL command numbers and async event
 * numbers — derived from public sources:
 *   - Infineon CYW43439 datasheet (gSPI section)
 *   - pico-sdk pico_cyw43_driver  (BSD-3)
 *   - jbentham/picowi             (MIT, see third-party/picowi/LICENSE)
 *
 * Re-implemented as TypeScript constants. No copyrighted text is
 * reproduced; the names match the de-facto Broadcom / Cypress
 * convention used by every open driver.
 */

// ── F0 (gSPI bus control) registers ────────────────────────────────
export const F0 = {
  BUS_CTRL: 0x00,
  RESPONSE_DELAY: 0x04,
  STATUS_ENABLE: 0x08,
  RESET_BP: 0x0c,
  INTR_STATUS: 0x04, // also accessible at this alias on some chips
  READ_TEST: 0x14,
  WRITE_TEST: 0x18,
  INTERRUPT: 0x20,
  INTERRUPT_ENABLE: 0x24,
  STATUS: 0x08,
  BUS_CTRL2: 0x2c,
  FUNCTION_INT_MASK: 0x30,
  F2_INFO: 0x3c,
} as const;

/** Magic value the driver polls F0:0x14 for once the chip is ready. */
export const TEST_PATTERN = 0xfeedbead >>> 0;

// ── F1 (backplane) — register window addresses we honour ──────────
export const F1 = {
  SDIO_CHIP_CLOCK_CSR: 0x1000e,
  SDIO_BACKPLANE_ADDRESS_LOW: 0x1000a,
  SDIO_BACKPLANE_ADDRESS_MID: 0x1000b,
  SDIO_BACKPLANE_ADDRESS_HIGH: 0x1000c,
  SDIO_PULL_UP: 0x1000f,
  SDIO_FRAME_CONTROL: 0x1000d,
  SDIO_INT_STATUS: 0x18002020, // SB_BASE_ADDR + 0x20
  SDIO_INT_HOST_MASK: 0x18002024,
  SDIO_TO_HOST_MAILBOX_DATA: 0x1800204c,
} as const;

/** Bits in SDIO_CHIP_CLOCK_CSR. */
export const ClockCsr = {
  ALP_AVAIL_REQ: 0x08,
  HT_AVAIL_REQ: 0x10,
  ALP_AVAIL: 0x40,
  HT_AVAIL: 0x80,
} as const;

// ── SDPCM channels ─────────────────────────────────────────────────
export const SdpcmChannel = {
  CONTROL: 0,
  EVENT: 1,
  DATA: 2,
  GLOM: 3,
} as const;

// ── WLC IOCTL commands (subset we implement) ──────────────────────
export const WLC = {
  GET_MAGIC: 0,
  GET_VERSION: 1,
  UP: 2,
  DOWN: 3,
  GET_INFRA: 19,
  SET_INFRA: 20,
  GET_AUTH: 21,
  SET_AUTH: 22,
  GET_BSSID: 23,
  SET_BSSID: 24,
  GET_SSID: 25,
  SET_SSID: 26,
  GET_CHANNEL: 29,
  SET_CHANNEL: 30,
  SCAN: 50,
  SCAN_RESULTS: 51,
  DISASSOC: 52,
  GET_PM: 85,
  SET_PM: 86,
  GET_VAR: 262,
  SET_VAR: 263,
  IOCTL_MAGIC: 0x14e46c77 >>> 0,
} as const;

// ── Async event numbers (chip → host on SDPCM channel 1) ──────────
export const WLC_E = {
  SET_SSID: 0,
  JOIN: 1,
  AUTH: 3,
  DEAUTH: 5,
  DEAUTH_IND: 6,
  ASSOC: 7,
  DISASSOC: 11,
  DISASSOC_IND: 12,
  LINK: 16,
  SCAN_COMPLETE: 26,
  JOIN_START: 36,
  ASSOC_START: 38,
  ESCAN_RESULT: 69,
} as const;

// ── Status codes used in event payloads ───────────────────────────
export const WLC_E_STATUS = {
  SUCCESS: 0,
  FAIL: 1,
  TIMEOUT: 2,
  NO_NETWORKS: 3,
  ABORT: 4,
} as const;

// ── Authentication / cipher selectors (matches Broadcom convention) ─
export const AUTH_TYPE = {
  OPEN: 0,
  SHARED: 1,
  WPA_PSK: 4,
  WPA2_PSK: 6,
} as const;

// ── Convenience: build an N-byte little-endian view of a uint32 ───
export function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = v & 0xff;
  b[1] = (v >>> 8) & 0xff;
  b[2] = (v >>> 16) & 0xff;
  b[3] = (v >>> 24) & 0xff;
  return b;
}
