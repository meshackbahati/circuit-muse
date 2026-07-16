/**
 * Shared 40-pin GPIO header layout used by every Raspberry Pi from the
 * 1B+ onwards (Zero W, 1B+, 2, 3, 4, 5).  Same physical positions, same
 * BCM GPIO assignment, same naming convention — so wires drawn against
 * a Pi 3 example transfer to a Pi 4 or Pi 5 board without re-routing.
 *
 * Coordinates are in CSS pixels relative to the board element's top-left,
 * sized to fit the 250×160 footprint shared by every Velxio Pi element.
 * Pin "1" sits top-left; odd pins on the top row, even on the bottom.
 *
 * Names follow the Pi 3 wrapper convention (BCM GPIO numbers like
 * "GPIO14" plus power/ground labels) so example wires using those names
 * resolve to the same physical position on every Pi model.
 */

export interface PinInfo {
  name: string;
  x: number;
  y: number;
  signals: string[];
}

const PIN_X_START = 20;
const PIN_X_STEP = 10;
const PIN_Y_TOP = 10;
const PIN_Y_BOT = 20;

const PI_PIN_NAMES: Record<number, string> = {
  1: '3V3',     2: '5V',
  3: 'GPIO2',   4: '5V',
  5: 'GPIO3',   6: 'GND',
  7: 'GPIO4',   8: 'GPIO14',
  9: 'GND',    10: 'GPIO15',
  11: 'GPIO17', 12: 'GPIO18',
  13: 'GPIO27', 14: 'GND',
  15: 'GPIO22', 16: 'GPIO23',
  17: '3V3',   18: 'GPIO24',
  19: 'GPIO10', 20: 'GND',
  21: 'GPIO9',  22: 'GPIO25',
  23: 'GPIO11', 24: 'GPIO8',
  25: 'GND',   26: 'GPIO7',
  27: 'ID_SD', 28: 'ID_SC',
  29: 'GPIO5',  30: 'GND',
  31: 'GPIO6',  32: 'GPIO12',
  33: 'GPIO13', 34: 'GND',
  35: 'GPIO19', 36: 'GPIO16',
  37: 'GPIO26', 38: 'GPIO20',
  39: 'GND',   40: 'GPIO21',
};

export function buildPi40PinHeader(): PinInfo[] {
  const pins: PinInfo[] = [];
  for (let col = 0; col < 20; col++) {
    const oddPin = col * 2 + 1;   // top row
    const evenPin = col * 2 + 2;  // bottom row
    const px = PIN_X_START + col * PIN_X_STEP;
    pins.push({
      name: PI_PIN_NAMES[oddPin] ?? `P${oddPin}`,
      x: px,
      y: PIN_Y_TOP,
      signals: [],
    });
    pins.push({
      name: PI_PIN_NAMES[evenPin] ?? `P${evenPin}`,
      x: px,
      y: PIN_Y_BOT,
      signals: [],
    });
  }
  return pins;
}
