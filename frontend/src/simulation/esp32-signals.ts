/**
 * ESP32 GPIO Matrix output signal source IDs.
 *
 * Mirror of `backend/app/services/esp32_signals.py`. Keep both
 * files in sync — the worker emits the numeric ids defined in the
 * Python module via WebSocket and the frontend interprets them
 * here. The constants come from the ESP32 Technical Reference
 * Manual section 4.11 ("IO_MUX and GPIO Matrix").
 */

// ── LEDC (PWM peripheral) ─────────────────────────────────────────────────
// Per ESP32 TRM section 4.11, Table 4-3 (GPIO Matrix output signals):
//   71-78 → LEDC_HS_SIG_OUT[0..7]  (high-speed channels 0-7)
//   79-86 → LEDC_LS_SIG_OUT[0..7]  (low-speed  channels 0-7)
// The legacy worker code used 72-87 (off by one). That bug rerouted
// every multi-servo project's channels — see
// backend/app/services/esp32_signals.py for the full explanation.
export const SIG_LEDC_HS_CH0_OUT_IDX = 71;
export const SIG_LEDC_HS_CH_LAST = 78;
export const SIG_LEDC_LS_CH0_OUT_IDX = 79;
export const SIG_LEDC_LS_CH_LAST = 86;

/**
 * Map a velxio-style unified LEDC channel index (0..15) to its GPIO
 * Matrix signal source id. velxio unifies HS + LS into 0..15 where
 * 0-7 = HS, 8-15 = LS — matches the encoding the QEMU plugin emits
 * on the 0x5000 duty callback.
 */
export function ledcSignalForChannel(channel: number): number {
  if (channel < 0 || channel >= 16 || !Number.isInteger(channel)) {
    throw new Error(`ledc channel out of range: ${channel}`);
  }
  return channel < 8
    ? SIG_LEDC_HS_CH0_OUT_IDX + channel
    : SIG_LEDC_LS_CH0_OUT_IDX + (channel - 8);
}

/**
 * Inverse of {@link ledcSignalForChannel}. Returns null when the
 * signal id is not an LEDC channel.
 */
export function channelForLedcSignal(signalId: number): number | null {
  if (signalId >= SIG_LEDC_HS_CH0_OUT_IDX && signalId <= SIG_LEDC_HS_CH_LAST) {
    return signalId - SIG_LEDC_HS_CH0_OUT_IDX;
  }
  if (signalId >= SIG_LEDC_LS_CH0_OUT_IDX && signalId <= SIG_LEDC_LS_CH_LAST) {
    return 8 + (signalId - SIG_LEDC_LS_CH0_OUT_IDX);
  }
  return null;
}

// ── Sentinel: GPIO not routed (driven by GPIO_OUT_REG bit directly) ──────
export const SIG_GPIO_DIRECT_OUT_IDX = 256;
