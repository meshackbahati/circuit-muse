/**
 * Board protocol pin classifier.
 *
 * Given a (boardKind, pinName) pair, return the protocol role of that
 * pin (UART TX/RX, I2C SDA/SCL, SPI MISO/MOSI/SCK, raw digital, or
 * power). Used by the Interconnect router as a hint for enabling
 * byte-level UART shortcut on cross-process boards.
 *
 * Pin-level propagation works regardless of classification. The
 * classifier is purely an optimization — when a wire connects two
 * UART pins on at least one cross-process simulator (ESP32 / Pi3B),
 * we additionally route per-byte serial data so that high-baud links
 * don't drop bytes when the WebSocket round-trip would be too slow.
 *
 * Pin naming is normalized: "D7" → "7", "GP10" → "10". This module
 * uses the board's preferred naming convention as the lookup key,
 * but accepts numeric / D-prefix / GP-prefix interchangeably where
 * the board does.
 */

import type { BoardKind } from '../types/board';

export type PinRole =
  | { kind: 'uart-tx'; uart: number }
  | { kind: 'uart-rx'; uart: number }
  | { kind: 'i2c-sda'; bus: number }
  | { kind: 'i2c-scl'; bus: number }
  | { kind: 'spi-mosi'; bus: number }
  | { kind: 'spi-miso'; bus: number }
  | { kind: 'spi-sck'; bus: number }
  | { kind: 'spi-cs'; bus: number }
  | { kind: 'digital' }
  | { kind: 'power' };

// ── Per-board protocol pin tables ────────────────────────────────────────────

/**
 * Each entry maps a NORMALIZED pin name (the most canonical form for
 * that board) to a PinRole. The classifier accepts aliases by trying
 * several normalization forms.
 */
type RoleTable = Record<string, PinRole>;

const ARDUINO_UNO: RoleTable = {
  '0': { kind: 'uart-rx', uart: 0 },
  '1': { kind: 'uart-tx', uart: 0 },
  '11': { kind: 'spi-mosi', bus: 0 },
  '12': { kind: 'spi-miso', bus: 0 },
  '13': { kind: 'spi-sck', bus: 0 },
  '10': { kind: 'spi-cs', bus: 0 },
  // Uno I2C is on A4 (= D18) / A5 (= D19)
  '18': { kind: 'i2c-sda', bus: 0 },
  '19': { kind: 'i2c-scl', bus: 0 },
};

const ARDUINO_NANO = ARDUINO_UNO; // same pinout

const ARDUINO_MEGA: RoleTable = {
  '0': { kind: 'uart-rx', uart: 0 },
  '1': { kind: 'uart-tx', uart: 0 },
  '19': { kind: 'uart-rx', uart: 1 },
  '18': { kind: 'uart-tx', uart: 1 },
  '17': { kind: 'uart-rx', uart: 2 },
  '16': { kind: 'uart-tx', uart: 2 },
  '15': { kind: 'uart-rx', uart: 3 },
  '14': { kind: 'uart-tx', uart: 3 },
  '20': { kind: 'i2c-sda', bus: 0 },
  '21': { kind: 'i2c-scl', bus: 0 },
  '50': { kind: 'spi-miso', bus: 0 },
  '51': { kind: 'spi-mosi', bus: 0 },
  '52': { kind: 'spi-sck', bus: 0 },
  '53': { kind: 'spi-cs', bus: 0 },
};

const RP2040_DEFAULT: RoleTable = {
  // Default (Earle Philhower core) Serial1 = UART0 on GP0/GP1
  '0': { kind: 'uart-tx', uart: 0 },
  '1': { kind: 'uart-rx', uart: 0 },
  // Default Serial2 = UART1 on GP4/GP5 (also default I2C0 — ambiguous;
  // we classify these as I2C since that's the most common Wokwi config)
  '4': { kind: 'i2c-sda', bus: 0 },
  '5': { kind: 'i2c-scl', bus: 0 },
  // I2C1 (alt)
  '6': { kind: 'i2c-sda', bus: 1 },
  '7': { kind: 'i2c-scl', bus: 1 },
  // SPI0
  '16': { kind: 'spi-miso', bus: 0 },
  '17': { kind: 'spi-cs', bus: 0 },
  '18': { kind: 'spi-sck', bus: 0 },
  '19': { kind: 'spi-mosi', bus: 0 },
  // UART1 (alt — only if user explicitly wires there, not as I2C0)
  // Note: same pins as I2C0 → I2C wins by default classification above.
};

const ESP32_DEFAULT: RoleTable = {
  '1': { kind: 'uart-tx', uart: 0 },
  '3': { kind: 'uart-rx', uart: 0 },
  // UART2 default
  '17': { kind: 'uart-tx', uart: 2 },
  '16': { kind: 'uart-rx', uart: 2 },
  // I2C0
  '21': { kind: 'i2c-sda', bus: 0 },
  '22': { kind: 'i2c-scl', bus: 0 },
  // VSPI
  '23': { kind: 'spi-mosi', bus: 0 },
  '19': { kind: 'spi-miso', bus: 0 },
  '18': { kind: 'spi-sck', bus: 0 },
  '5': { kind: 'spi-cs', bus: 0 },
};

const ESP32_C3_DEFAULT: RoleTable = {
  '21': { kind: 'uart-tx', uart: 0 },
  '20': { kind: 'uart-rx', uart: 0 },
  '5': { kind: 'i2c-sda', bus: 0 },
  '6': { kind: 'i2c-scl', bus: 0 },
};

// Pi3B uses BCM numbers internally (after physical→BCM translation)
const PI3_BCM: RoleTable = {
  '14': { kind: 'uart-tx', uart: 0 },
  '15': { kind: 'uart-rx', uart: 0 },
  '2': { kind: 'i2c-sda', bus: 1 },
  '3': { kind: 'i2c-scl', bus: 1 },
  '10': { kind: 'spi-mosi', bus: 0 },
  '9': { kind: 'spi-miso', bus: 0 },
  '11': { kind: 'spi-sck', bus: 0 },
  '8': { kind: 'spi-cs', bus: 0 },
};

// ── Pi3B physical → BCM mirror (matches frontend/src/utils/boardPinMapping.ts) ─
const PI3_PHYSICAL_TO_BCM: Record<number, number> = {
  3: 2, 5: 3, 7: 4, 8: 14, 10: 15,
  11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24,
  19: 10, 21: 9, 22: 25, 23: 11, 24: 8, 26: 7,
  29: 5, 31: 6, 32: 12, 33: 13,
  35: 19, 36: 16, 37: 26, 38: 20, 40: 21,
};

// ── Master table ─────────────────────────────────────────────────────────────

// STM32 Blue Pill (F103). Keyed by the silkscreen port labels used in wires.
// USART1 = PA9 (TX) / PA10 (RX); USART2 = PA2 (TX) / PA3 (RX). The worker
// reports USART1 as uart 0 (usart[0]).
const STM32_DEFAULT: RoleTable = {
  PA9: { kind: 'uart-tx', uart: 0 },
  PA10: { kind: 'uart-rx', uart: 0 },
  PA2: { kind: 'uart-tx', uart: 1 },
  PA3: { kind: 'uart-rx', uart: 1 },
};

function tableFor(boardKind: BoardKind | string): RoleTable | null {
  if (boardKind === 'stm32-bluepill' || (boardKind as string).startsWith('stm32-')) return STM32_DEFAULT;
  if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') return ARDUINO_UNO;
  if (boardKind === 'arduino-mega') return ARDUINO_MEGA;
  if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') return RP2040_DEFAULT;
  if (boardKind === 'esp32-c3' || (boardKind as string).startsWith('esp32-c3')) return ESP32_C3_DEFAULT;
  if (boardKind === 'esp32' || (boardKind as string).startsWith('esp32')) return ESP32_DEFAULT;
  // Pi Zero/1/2/3/4/5 all share the same 40-pin GPIO header → same BCM table.
  if ((boardKind as string).startsWith('raspberry-pi-'))
    return PI3_BCM;
  return ARDUINO_NANO; // default fallback: treat unknown as arduino-uno-like
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a pin name to a numeric string, suitable for table lookup.
 * Returns null for power pins (GND/VCC/3V3/5V/VBUS/VSYS).
 */
function normalizePinName(boardKind: string, pinName: string): string | null {
  const trimmed = pinName.trim().toUpperCase();
  if (
    trimmed === 'GND' ||
    trimmed === 'VCC' ||
    trimmed === '3V3' ||
    trimmed.startsWith('3.3') ||
    trimmed === '5V' ||
    trimmed === 'VBUS' ||
    trimmed === 'VSYS' ||
    trimmed === 'AREF'
  ) {
    return null;
  }

  // Pi 3/4/5 all accept physical pin numbers (1..40) which map to BCM
  if (
    boardKind === 'raspberry-pi-3' ||
    boardKind === 'raspberry-pi-4' ||
    boardKind === 'raspberry-pi-5' ||
    boardKind.startsWith('raspberry-pi-3') ||
    boardKind.startsWith('raspberry-pi-4') ||
    boardKind.startsWith('raspberry-pi-5')
  ) {
    const phys = parseInt(trimmed, 10);
    if (!isNaN(phys)) {
      const bcm = PI3_PHYSICAL_TO_BCM[phys];
      return bcm !== undefined ? String(bcm) : null;
    }
    return null;
  }

  // GP-prefix: "GP10" → "10"
  if (trimmed.startsWith('GP')) {
    const n = parseInt(trimmed.substring(2), 10);
    return isNaN(n) ? null : String(n);
  }

  // D-prefix: "D7" → "7"
  if (trimmed.startsWith('D')) {
    const n = parseInt(trimmed.substring(1), 10);
    if (!isNaN(n)) return String(n);
  }

  // A-prefix on Uno/Nano: A0..A5 → 14..19; on Mega: A0..A15 → 54..69
  if (trimmed.startsWith('A')) {
    const n = parseInt(trimmed.substring(1), 10);
    if (!isNaN(n)) {
      if (boardKind === 'arduino-mega') return String(54 + n);
      return String(14 + n); // Uno/Nano
    }
  }

  // GPIO-prefix (ESP32): "GPIO5" → "5"
  if (trimmed.startsWith('GPIO')) {
    const n = parseInt(trimmed.substring(4), 10);
    return isNaN(n) ? null : String(n);
  }

  // TX/RX aliases — board-specific
  if (trimmed === 'TX') {
    if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') return '1';
    if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') return '0';
    if (boardKind === 'esp32') return '1';
  }
  if (trimmed === 'RX') {
    if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') return '0';
    if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') return '1';
    if (boardKind === 'esp32') return '3';
  }
  if (trimmed === 'SDA') {
    if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') return '18';
    if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') return '4';
    if (boardKind === 'esp32') return '21';
  }
  if (trimmed === 'SCL') {
    if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') return '19';
    if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') return '5';
    if (boardKind === 'esp32') return '22';
  }

  // STM32 port labels (PA9, PB12, PC13…) are used verbatim as table keys.
  if (/^P[A-G]\d{1,2}$/.test(trimmed)) {
    return trimmed;
  }

  // Bare numeric
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? null : String(n);
}

export function classifyPin(boardKind: string, pinName: string): PinRole {
  const trimmed = pinName.trim().toUpperCase();
  if (
    trimmed === 'GND' ||
    trimmed === 'VCC' ||
    trimmed === '3V3' ||
    trimmed.startsWith('3.3') ||
    trimmed === '5V' ||
    trimmed === 'VBUS' ||
    trimmed === 'VSYS'
  ) {
    return { kind: 'power' };
  }
  const normalized = normalizePinName(boardKind, pinName);
  if (normalized === null) return { kind: 'digital' }; // unknown alias: treat as raw digital
  const table = tableFor(boardKind);
  const role = table?.[normalized];
  return role ?? { kind: 'digital' };
}

/**
 * Returns true if both endpoints of a wire are UART pins on the same
 * UART number (one TX, one RX). Used to enable byte-level shortcut.
 */
export function isUartWire(
  boardA: string,
  pinA: string,
  boardB: string,
  pinB: string,
): { uartA: number; uartB: number } | null {
  const ra = classifyPin(boardA, pinA);
  const rb = classifyPin(boardB, pinB);
  if (ra.kind === 'uart-tx' && rb.kind === 'uart-rx') return { uartA: ra.uart, uartB: rb.uart };
  if (ra.kind === 'uart-rx' && rb.kind === 'uart-tx') return { uartA: ra.uart, uartB: rb.uart };
  return null;
}
