/**
 * Bmp280Element.ts — BMP280 barometric pressure + temperature sensor
 *
 * wokwi-elements does not include a BMP280, so we ship our own. The visual
 * is the Fritzing-drawn BMP180 breakout (mechanically identical Bosch
 * predecessor — same I2C interface, same 4-pin pinout) loaded as a static
 * asset from /component-svgs/bmp280.svg. Original SVG copied verbatim from
 * third-party/fritzing-parts/svg/core/breadboard/bmp180_breadboard.svg
 * (CC-BY-SA, see THIRDPARTY_LICENSES.md).
 *
 * Geometry (matches the Fritzing source):
 *   viewBox 28.35 × 35.43 mm, scaled uniformly at 2.822 px/mm → 80 × 100 px.
 *   Connector centres in the source SVG (mm): all at y=4.821, with
 *     SDA → x=3.375    GND → x=17.773
 *     SCL → x=10.574   VCC → x=24.975
 *   Maps to CSS px (x ≈ mm × 2.822):
 *     SDA(9.5, 13.6)   GND(50.2, 13.6)
 *     SCL(29.8, 13.6)  VCC(70.5, 13.6)
 *
 * Pin order/names taken from third-party/fritzing-parts/core/bmp180_breakout.fzp
 * (Adafruit BMP180 breakout, variant 3).
 */

const W = 80;          // CSS px
const H = 100;
const PIN_Y = 13.6;    // CSS px — y of all four pin tips

const PIN_INFO = [
  { name: 'SDA', x: 9.5,  y: PIN_Y, number: 1, signals: [] as Array<unknown> },
  { name: 'SCL', x: 29.8, y: PIN_Y, number: 2, signals: [] as Array<unknown> },
  { name: 'GND', x: 50.2, y: PIN_Y, number: 3, signals: [{ type: 'power', signal: 'GND' }] },
  { name: 'VCC', x: 70.5, y: PIN_Y, number: 4, signals: [{ type: 'power', signal: 'VCC' }] },
];

class Bmp280Element extends HTMLElement {
  readonly pinInfo = PIN_INFO;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; }
        svg   { display: block; overflow: visible; }
        .pin-label {
          font: 600 6px monospace;
          fill: #cdf;
          text-anchor: middle;
          pointer-events: none;
        }
      </style>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <!-- Fritzing BMP180 breakout artwork (CC-BY-SA). The asset
             ships as a public static file so it stays editable separately. -->
        <image href="/component-svgs/bmp280.svg" x="0" y="0" width="${W}" height="${H}" />

        <!-- Pin labels overlaid above the connector circles. The Fritzing
             source has no silkscreen labels on the pins themselves. -->
        <text class="pin-label" x="9.5"  y="6">SDA</text>
        <text class="pin-label" x="29.8" y="6">SCL</text>
        <text class="pin-label" x="50.2" y="6">GND</text>
        <text class="pin-label" x="70.5" y="6">VCC</text>
      </svg>`;
  }
}

if (!customElements.get('velxio-bmp280')) {
  customElements.define('velxio-bmp280', Bmp280Element);
}
