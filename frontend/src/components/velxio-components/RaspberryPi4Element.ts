/**
 * Raspberry Pi 4 Model B — Velxio board art.
 *
 * Uses a realistic top-down product photo of the Raspberry Pi 4 as the board
 * sprite. The source shipped on a solid white background; it was flood-filled
 * to a transparent PNG and cropped tight to the board outline so it composites
 * cleanly on the canvas -> frontend/src/assets/raspberry-pi-4-board.png.
 *
 * The 40-pin GPIO header coordinates were calibrated against that image and
 * are exposed through the `pinInfo` getter, so the wire system anchors every
 * wire on the real header pins. Pin names follow the standard BCM/40-pin
 * convention shared by every Pi from the 1B+ onwards, so example wires
 * transfer between Pi models by name.
 */

import pi4img from '../../assets/raspberry-pi-4-board.png';

// Native size of the cropped, transparent board PNG, and on-canvas render size.
const NATIVE_W = 925;
const NATIVE_H = 602;
const DISPLAY_W = 330;
const SCALE = DISPLAY_W / NATIVE_W;
const DISPLAY_H = Math.round(NATIVE_H * SCALE);

// GPIO 40-pin header calibration, in native cropped-PNG pixels.
const HDR_X0 = 108;
const HDR_STEP = 25.8;
const HDR_Y_TOP = 26;
const HDR_Y_BOT = 51;

// Standard Raspberry Pi 40-pin header pin-name map (physical pin -> name).
const PI_PIN_NAMES: Record<number, string> = {
  1: '3V3', 2: '5V',
  3: 'GPIO2', 4: '5V',
  5: 'GPIO3', 6: 'GND',
  7: 'GPIO4', 8: 'GPIO14',
  9: 'GND', 10: 'GPIO15',
  11: 'GPIO17', 12: 'GPIO18',
  13: 'GPIO27', 14: 'GND',
  15: 'GPIO22', 16: 'GPIO23',
  17: '3V3', 18: 'GPIO24',
  19: 'GPIO10', 20: 'GND',
  21: 'GPIO9', 22: 'GPIO25',
  23: 'GPIO11', 24: 'GPIO8',
  25: 'GND', 26: 'GPIO7',
  27: 'ID_SD', 28: 'ID_SC',
  29: 'GPIO5', 30: 'GND',
  31: 'GPIO6', 32: 'GPIO12',
  33: 'GPIO13', 34: 'GND',
  35: 'GPIO19', 36: 'GPIO16',
  37: 'GPIO26', 38: 'GPIO20',
  39: 'GND', 40: 'GPIO21',
};

class RaspberryPi4Element extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  /**
   * Pin tip coordinates in CSS pixels relative to the element's top-left,
   * calibrated to the GPIO header in the board photo. Odd pins (1,3,5…) on
   * the top row, even pins (2,4,6…) on the bottom row, pin 1 left-most.
   */
  get pinInfo() {
    const pins: { name: string; x: number; y: number; signals: string[] }[] = [];
    for (let col = 0; col < 20; col++) {
      const oddPin = col * 2 + 1; // top row
      const evenPin = col * 2 + 2; // bottom row
      const px = (HDR_X0 + col * HDR_STEP) * SCALE;
      pins.push({
        name: PI_PIN_NAMES[oddPin] ?? `P${oddPin}`,
        x: px,
        y: HDR_Y_TOP * SCALE,
        signals: [],
      });
      pins.push({
        name: PI_PIN_NAMES[evenPin] ?? `P${evenPin}`,
        x: px,
        y: HDR_Y_BOT * SCALE,
        signals: [],
      });
    }
    return pins;
  }

  render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: block;
          width: ${DISPLAY_W}px;
          height: ${DISPLAY_H}px;
          position: relative;
        }
        img {
          width: 100%;
          height: 100%;
          display: block;
          user-select: none;
          -webkit-user-drag: none;
          pointer-events: none;
        }
      </style>
      <img src="${pi4img}" alt="Raspberry Pi 4 Model B" draggable="false" />
    `;
  }
}

if (!customElements.get('velxio-raspberry-pi-4')) {
  customElements.define('velxio-raspberry-pi-4', RaspberryPi4Element);
}

export {};
