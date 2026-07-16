/**
 * STM32 board Web Components.
 *
 * Per CLAUDE.md rule 6a, boards that take wire connections MUST be real Web
 * Components exposing a `pinInfo` getter. Two render modes:
 *
 *  - 'svg':    renders the official wokwi-boards SVG with hand-placed pin
 *              coordinates (Blue Pill / Black Pill, and the pin-compatible
 *              F103CB / F401 variants reuse those exact SVGs).
 *  - 'inline': draws the board in-component (no SVG file) — a green PCB with an
 *              MCU square, labeled header pads computed from `headers`, and an
 *              onboard LED dot. Used by the Discovery / Olimex / Netduino boards
 *              for which wokwi-boards ships no SVG.
 *
 * Pin `name`s are the real port labels ('PA9', 'PC13', ...) so examples wire to
 * them; Stm32Bridge.stm32PinNameToLinear() maps them to the backend's linear
 * pin index (port*16 + pin).
 *
 * Registers one custom element per board (one tag, one subclass), all driven by
 * the shared Stm32BoardElement class and the CONFIGS table.
 */

interface PinDef {
  name: string;
  x: number;
  y: number;
}

interface BoardConfig {
  render: 'svg' | 'inline';
  w: number;
  h: number;
  pins: PinDef[];
  /** Onboard LED center (px). */
  led: { x: number; y: number };
  /** Active-LOW boards (Blue/Black Pill PC13) are lit when the pin is LOW. */
  ledActiveLow: boolean;
  // 'svg' mode only:
  svgUrl?: string;
  // 'inline' mode only:
  label?: string;
}

/** Which port pin carries the onboard LED, and its polarity, per board kind.
 *  Consumed by useSimulatorStore to light the correct LED dot. */
export const STM32_LED: Record<string, { pin: string; activeLow: boolean }> = {
  'stm32-bluepill': { pin: 'PC13', activeLow: true },
  'stm32-blackpill': { pin: 'PC13', activeLow: true },
  'stm32-bluepill-f103cb': { pin: 'PC13', activeLow: true },
  'stm32-blackpill-f401': { pin: 'PC13', activeLow: true },
  'stm32-f4-discovery': { pin: 'PD12', activeLow: false },
  'stm32-olimex-h405': { pin: 'PC12', activeLow: false },
  'stm32-netduino-plus2': { pin: 'PA10', activeLow: false },
  'stm32-netduino2': { pin: 'PA10', activeLow: false },
};

// ── STM32 Blue Pill (F103C8) — 22.855 x 54.193 mm -> 114 x 271 px ───────────
const BLUEPILL_PINS: PinDef[] = [
  { name: 'PB12', x: 18, y: 14 }, { name: 'PB13', x: 18, y: 27 },
  { name: 'PB14', x: 18, y: 40 }, { name: 'PB15', x: 18, y: 53 },
  { name: 'PA8', x: 18, y: 65 }, { name: 'PA9', x: 18, y: 78 },
  { name: 'PA10', x: 18, y: 91 }, { name: 'PA11', x: 18, y: 103 },
  { name: 'PA12', x: 18, y: 116 }, { name: 'PA15', x: 18, y: 129 },
  { name: 'PB3', x: 18, y: 142 }, { name: 'PB4', x: 18, y: 154 },
  { name: 'PB5', x: 18, y: 167 }, { name: 'PB6', x: 18, y: 180 },
  { name: 'PB7', x: 18, y: 192 }, { name: 'PB8', x: 18, y: 205 },
  { name: 'PB9', x: 18, y: 218 }, { name: '5V', x: 18, y: 230 },
  { name: 'GND', x: 18, y: 243 }, { name: '3V3', x: 18, y: 256 },
  { name: 'GND', x: 96, y: 14 }, { name: 'GND', x: 96, y: 27 },
  { name: '3V3', x: 96, y: 40 }, { name: 'NRST', x: 96, y: 53 },
  { name: 'PB11', x: 96, y: 65 }, { name: 'PB10', x: 96, y: 78 },
  { name: 'PB1', x: 96, y: 91 }, { name: 'PB0', x: 96, y: 103 },
  { name: 'PA7', x: 96, y: 116 }, { name: 'PA6', x: 96, y: 129 },
  { name: 'PA5', x: 96, y: 142 }, { name: 'PA4', x: 96, y: 154 },
  { name: 'PA3', x: 96, y: 167 }, { name: 'PA2', x: 96, y: 180 },
  { name: 'PA1', x: 96, y: 192 }, { name: 'PA0', x: 96, y: 205 },
  { name: 'PC15', x: 96, y: 218 }, { name: 'PC14', x: 96, y: 230 },
  { name: 'PC13', x: 96, y: 243 }, { name: 'VBAT', x: 96, y: 256 },
];

// ── STM32 Black Pill (F411CE) — 20.695 x 53.125 mm -> 103 x 266 px ──────────
const BLACKPILL_PINS: PinDef[] = [
  { name: 'VBAT', x: 13, y: 16 }, { name: 'PC13', x: 13, y: 28 },
  { name: 'PC14', x: 13, y: 41 }, { name: 'PC15', x: 13, y: 54 },
  { name: 'NRST', x: 13, y: 67 }, { name: 'PA0', x: 13, y: 79 },
  { name: 'PA1', x: 13, y: 92 }, { name: 'PA2', x: 13, y: 105 },
  { name: 'PA3', x: 13, y: 117 }, { name: 'PA4', x: 13, y: 130 },
  { name: 'PA5', x: 13, y: 143 }, { name: 'PA6', x: 13, y: 155 },
  { name: 'PA7', x: 13, y: 168 }, { name: 'PB0', x: 13, y: 181 },
  { name: 'PB1', x: 13, y: 194 }, { name: 'PB2', x: 13, y: 206 },
  { name: 'PB10', x: 13, y: 219 }, { name: '3V3', x: 13, y: 232 },
  { name: 'GND', x: 13, y: 244 }, { name: '5V', x: 13, y: 257 },
  { name: '3V3', x: 89, y: 14 }, { name: 'GND', x: 89, y: 27 },
  { name: '5V', x: 89, y: 40 }, { name: 'PB9', x: 89, y: 53 },
  { name: 'PB8', x: 89, y: 65 }, { name: 'PB7', x: 89, y: 78 },
  { name: 'PB6', x: 89, y: 91 }, { name: 'PB5', x: 89, y: 103 },
  { name: 'PB4', x: 89, y: 116 }, { name: 'PB3', x: 89, y: 129 },
  { name: 'PA15', x: 89, y: 142 }, { name: 'PA12', x: 89, y: 154 },
  { name: 'PA11', x: 89, y: 167 }, { name: 'PA10', x: 89, y: 180 },
  { name: 'PA9', x: 89, y: 192 }, { name: 'PA8', x: 89, y: 205 },
  { name: 'PB15', x: 89, y: 218 }, { name: 'PB14', x: 89, y: 230 },
  { name: 'PB13', x: 89, y: 243 }, { name: 'PB12', x: 89, y: 256 },
];

// ── Inline-rendered boards (no SVG) — generic PCB drawn from a header layout ──
// Geometry constants shared by every inline board.
const PAD_PITCH = 13;
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 16;
const INLINE_W = 158;
const TIP_L = 9; // left-column pin tip x (wire connection point)
const TIP_R = INLINE_W - 9; // right-column pin tip x

/** Build a flat BoardConfig for an inline board from its header pin lists.
 *  Computes pad/tip coordinates so `pinInfo` returns correct wire endpoints
 *  without per-pin hand placement. */
function inlineConfig(opts: {
  label: string;
  left: string[];
  right: string[];
  ledPin: string;
  ledActiveLow: boolean;
}): BoardConfig {
  const rows = Math.max(opts.left.length, opts.right.length);
  const h = MARGIN_TOP + rows * PAD_PITCH + MARGIN_BOTTOM;
  const pins: PinDef[] = [];
  opts.left.forEach((name, i) =>
    pins.push({ name, x: TIP_L, y: MARGIN_TOP + i * PAD_PITCH + PAD_PITCH / 2 }),
  );
  opts.right.forEach((name, i) =>
    pins.push({ name, x: TIP_R, y: MARGIN_TOP + i * PAD_PITCH + PAD_PITCH / 2 }),
  );
  // LED dot sits in the free center column, just under the board title.
  return {
    render: 'inline',
    label: opts.label,
    w: INLINE_W,
    h,
    pins,
    led: { x: INLINE_W / 2, y: MARGIN_TOP + 2 },
    ledActiveLow: opts.ledActiveLow,
  };
}

const CONFIGS: Record<string, BoardConfig> = {
  'stm32-bluepill': {
    render: 'svg', svgUrl: '/boards/stm32-bluepill.svg', w: 114, h: 271,
    pins: BLUEPILL_PINS, led: { x: 37, y: 228 }, ledActiveLow: true,
  },
  'stm32-blackpill': {
    render: 'svg', svgUrl: '/boards/stm32-blackpill.svg', w: 103, h: 266,
    pins: BLACKPILL_PINS, led: { x: 27, y: 55 }, ledActiveLow: true,
  },
  // Pin-compatible variants — reuse the Pill SVGs and pin coordinates.
  'stm32-bluepill-f103cb': {
    render: 'svg', svgUrl: '/boards/stm32-bluepill.svg', w: 114, h: 271,
    pins: BLUEPILL_PINS, led: { x: 37, y: 228 }, ledActiveLow: true,
  },
  'stm32-blackpill-f401': {
    render: 'svg', svgUrl: '/boards/stm32-blackpill.svg', w: 103, h: 266,
    pins: BLACKPILL_PINS, led: { x: 27, y: 55 }, ledActiveLow: true,
  },
  // Inline boards (F405 / F205 SoCs) — drawn generically.
  'stm32-f4-discovery': inlineConfig({
    label: 'STM32F4 Discovery',
    left: ['3V3', 'GND', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7',
      'PB0', 'PB1', 'PB2', 'PE0', 'PE1'],
    right: ['5V', 'GND', 'PD12', 'PD13', 'PD14', 'PD15', 'PC0', 'PC1', 'PC2',
      'PC3', 'PB6', 'PB7', 'PB8', 'PB9', 'PE2'],
    ledPin: 'PD12', ledActiveLow: false,
  }),
  'stm32-olimex-h405': inlineConfig({
    label: 'Olimex STM32-H405',
    left: ['3V3', 'GND', 'PA0', 'PA1', 'PA2', 'PA3', 'PB6', 'PB7', 'PB8', 'PB9',
      'PC0', 'PC1'],
    right: ['5V', 'GND', 'PC12', 'PC10', 'PC11', 'PA4', 'PA5', 'PA6', 'PA7',
      'PB0', 'PB1', 'PB10'],
    ledPin: 'PC12', ledActiveLow: false,
  }),
  'stm32-netduino-plus2': inlineConfig({
    label: 'Netduino Plus 2',
    left: ['3V3', 'GND', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PB6', 'PB7',
      'PB8', 'PB9'],
    right: ['5V', 'GND', 'PA10', 'PB11', 'PC0', 'PC1', 'PC2', 'PC3', 'PA6',
      'PA7', 'PB0', 'PB1'],
    ledPin: 'PA10', ledActiveLow: false,
  }),
  'stm32-netduino2': inlineConfig({
    label: 'Netduino 2',
    left: ['3V3', 'GND', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PB6', 'PB7',
      'PB8', 'PB9'],
    right: ['5V', 'GND', 'PA10', 'PB11', 'PC0', 'PC1', 'PC2', 'PC3', 'PA6',
      'PA7', 'PB0', 'PB1'],
    ledPin: 'PA10', ledActiveLow: false,
  }),
};

/** Tag name -> CONFIGS key. One custom element per board kind. */
const TAG_TO_KIND: Record<string, string> = {
  'velxio-stm32-bluepill': 'stm32-bluepill',
  'velxio-stm32-blackpill': 'stm32-blackpill',
  'velxio-stm32-bluepill-f103cb': 'stm32-bluepill-f103cb',
  'velxio-stm32-blackpill-f401': 'stm32-blackpill-f401',
  'velxio-stm32-f4-discovery': 'stm32-f4-discovery',
  'velxio-stm32-olimex-h405': 'stm32-olimex-h405',
  'velxio-stm32-netduino-plus2': 'stm32-netduino-plus2',
  'velxio-stm32-netduino2': 'stm32-netduino2',
};

// Import-safe base. vitest runs in the 'node' environment where HTMLElement is
// undefined, and this module is imported eagerly by useSimulatorStore (for the
// STM32_LED map). Fall back to a dummy base so the module loads in node; in the
// browser this is the real HTMLElement.
const HTMLElementCtor: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

class Stm32BoardElement extends HTMLElementCtor {
  static get observedAttributes() {
    return ['board-kind'];
  }
  private _ledOn = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }
  attributeChangedCallback() {
    this.render();
  }

  private get config(): BoardConfig {
    const kind = this.getAttribute('board-kind') ?? this._defaultKind();
    return CONFIGS[kind] ?? CONFIGS['stm32-bluepill'];
  }

  private _defaultKind(): string {
    return TAG_TO_KIND[this.tagName.toLowerCase()] ?? 'stm32-bluepill';
  }

  /** Pin tip coordinates in CSS px relative to element top-left (rule 6a). */
  get pinInfo(): PinDef[] {
    return this.config.pins;
  }

  /** Onboard LED (visual lit state; store passes polarity-corrected value). */
  set led(on: boolean) {
    if (this._ledOn === on) return;
    this._ledOn = on;
    const el = this.shadowRoot?.getElementById('led');
    if (el) el.style.opacity = on ? '1' : '0';
  }
  get led(): boolean {
    return this._ledOn;
  }

  private render() {
    if (!this.shadowRoot) return;
    if (this.config.render === 'inline') {
      this.renderInline(this.config);
    } else {
      this.renderSvg(this.config);
    }
  }

  private renderSvg(cfg: BoardConfig) {
    if (!this.shadowRoot) return;
    const { svgUrl, w, h, led } = cfg;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; position: relative; }
        img { display: block; }
        #led {
          position: absolute; left: ${led.x - 4}px; top: ${led.y - 4}px;
          width: 8px; height: 8px; border-radius: 50%;
          background: #ff3b30; box-shadow: 0 0 6px 2px #ff3b30;
          opacity: 0; transition: opacity 40ms linear; pointer-events: none;
        }
      </style>
      <img src="${svgUrl}" width="${w}" height="${h}" draggable="false" alt="STM32 board" />
      <div id="led"></div>
    `;
  }

  private renderInline(cfg: BoardConfig) {
    if (!this.shadowRoot) return;
    const { w, h, pins, led, label } = cfg;
    const mcu = 50;
    const padHtml = pins
      .map((p) => {
        const onLeft = p.x <= w / 2;
        const padX = onLeft ? 4 : w - 14; // 10px-wide pad, center aligns to tip
        const labelStyle = onLeft
          ? `left:${padX + 13}px; text-align:left;`
          : `right:${w - padX + 3}px; text-align:right;`;
        return (
          `<div class="pad" style="left:${padX}px; top:${p.y - 4}px;"></div>` +
          `<div class="plabel" style="top:${p.y - 5}px; ${labelStyle}">${p.name}</div>`
        );
      })
      .join('');
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; position: relative; }
        .pcb {
          position: relative; box-sizing: border-box;
          background: #0b6b3a; border-radius: 8px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        .title {
          position: absolute; top: 4px; left: 0; right: 0; text-align: center;
          font-size: 8px; color: #d6efe0; letter-spacing: 0.3px; line-height: 1;
        }
        .mcu {
          position: absolute; background: #161616; border-radius: 3px;
          box-shadow: inset 0 0 0 1px #333, 0 1px 2px rgba(0,0,0,0.4);
        }
        .pad {
          position: absolute; width: 10px; height: 8px;
          background: #d4af37; border-radius: 2px;
        }
        .plabel {
          position: absolute; font-size: 7px; color: #eaf5ee;
          line-height: 1; white-space: nowrap;
        }
        #led {
          position: absolute; left: ${led.x - 5}px; top: ${led.y - 5}px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #00e676; box-shadow: 0 0 6px 2px #00e676;
          opacity: 0; transition: opacity 40ms linear; pointer-events: none;
        }
      </style>
      <div class="pcb" style="width:${w}px; height:${h}px;">
        <div class="title">${label ?? 'STM32'}</div>
        <div class="mcu" style="left:${w / 2 - mcu / 2}px; top:${h * 0.42}px; width:${mcu}px; height:${mcu}px;"></div>
        ${padHtml}
        <div id="led"></div>
      </div>
    `;
  }
}

export { Stm32BoardElement as Stm32BluePillElement };

// One unique constructor per tag — customElements.define() requires it.
// Guarded for non-DOM environments (vitest 'node') where customElements
// is undefined; registration only matters in the browser.
if (typeof customElements !== 'undefined') {
  for (const tag of Object.keys(TAG_TO_KIND)) {
    if (!customElements.get(tag)) {
      const cls = class extends Stm32BoardElement {};
      customElements.define(tag, cls);
    }
  }
}
