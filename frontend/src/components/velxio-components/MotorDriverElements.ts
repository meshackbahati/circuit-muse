/**
 * MotorDriverElements.ts — velxio-a4988 bipolar stepper driver (Pololu-style).
 *
 * Logic side (left column) takes STEP / DIR (+ EN, MS1-3, RST, SLP) from the
 * MCU; the motor side (right column) outputs the two coil pairs 1A/1B (coil A)
 * and 2A/2B (coil B) to a bipolar stepper's A+/A-/B+/B- terminals.
 *
 * The element is purely visual (a DIP-style module). The rotation logic lives
 * in simulation/parts/MotorDriverParts.ts: on each STEP rising edge it advances
 * the connected wokwi-stepper-motor by one (micro)step in the DIR direction.
 *
 * Tag: velxio-a4988  (metadataId 'a4988' via stripBrandPrefix).
 */

const STYLE = ':host{display:inline-block;line-height:0;position:relative}';

type Pin = { name: string; x: number; y: number; number: number; signals: string[] };

// Pin order matches the Fritzing Pololu A4988 part (pololu0002_a988):
//   left column, top -> bottom: ENABLE MS1 MS2 MS3 RESET SLEEP STEP DIR
//   right column, top -> bottom: VMOT GND 2B 2A 1A 1B VDD GND
const LEFT = ['ENABLE', 'MS1', 'MS2', 'MS3', 'RESET', 'SLEEP', 'STEP', 'DIR'];
const RIGHT = ['VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND.2'];

// Render the real Fritzing A4988 carrier SVG (public/components/a4988.svg).
// The board is a uniform 2x8 0.1" header, so the connection points sit on an
// even grid aligned to the two pad columns (margins tuned to the artwork).
const SVG_URL = '/components/a4988.svg';
const W = 72;
const H = 96;
const TOP_FRAC = 0.115;
const BOT_FRAC = 0.885;
const LEFT_FRAC = 0.085;
const RIGHT_FRAC = 0.915;

function a4988Pins(): Pin[] {
  const pins: Pin[] = [];
  const topY = TOP_FRAC * H;
  const stepY = ((BOT_FRAC - TOP_FRAC) * H) / (LEFT.length - 1);
  LEFT.forEach((name, i) =>
    pins.push({ name, x: LEFT_FRAC * W, y: topY + i * stepY, number: i + 1, signals: [] }),
  );
  RIGHT.forEach((name, i) =>
    pins.push({ name, x: RIGHT_FRAC * W, y: topY + i * stepY, number: LEFT.length + i + 1, signals: [] }),
  );
  return pins;
}

class A4988Element extends HTMLElement {
  readonly pinInfo = a4988Pins();
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML =
      `<style>${STYLE}</style>` +
      `<img src="${SVG_URL}" width="${W}" height="${H}" draggable="false" alt="A4988 stepper driver" />`;
  }
}

if (!customElements.get('velxio-a4988')) {
  customElements.define('velxio-a4988', A4988Element);
}

export {};
