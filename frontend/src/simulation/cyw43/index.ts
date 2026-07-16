/**
 * cyw43 — Pico W WiFi (CYW43439) emulation surface
 *
 * Wraps the chip-side state machine (Cyw43Emulator) and the network
 * bridge (Cyw43Bridge) so the rest of the frontend imports from a
 * single barrel.
 *
 * Reference research and prototype tests live at
 *   test/test_Raspberry_Pi_Pico_W/
 * which itself credits the public sources used to derive the protocol:
 *   - Infineon CYW43439 datasheet
 *   - raspberrypi/pico-sdk pico_cyw43_driver  (BSD-3)
 *   - jbentham/picowi                          (MIT)
 *
 * No closed firmware blob is shipped or executed — see
 *   docs/PICO_W_WIFI_EMULATION.md
 */

// Re-export modules. constants.ts owns the truth on AUTH_TYPE/WLC/WLC_E/WLC_E_STATUS;
// Cyw43Emulator.ts re-exports them as a convenience and we mask those here so
// the public surface only exposes one binding per name.
export * from './constants';
export * from './sdpcm';
export * from './virtual-ap';
export * from './PioBusSniffer';
export {
  Cyw43Emulator,
  type Cyw43EmulatorOptions,
  type LinkState,
  type LedEvent,
  type ScanEvent,
  type ConnectEvent,
  type DisconnectEvent,
  type PacketOutEvent,
} from './Cyw43Emulator';
export * from './Cyw43Bridge';
