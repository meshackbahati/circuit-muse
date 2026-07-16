/**
 * <velxio-custom-chip> — Web Component that renders a Velxio custom chip
 * (DIP-style chip body + labelled pins) on the Velxio canvas.
 *
 * Reads `chipJson` (JSON string with `pins: string[]`) from a property and
 * exposes a `pinInfo` getter that DynamicComponent + PinOverlay consume to
 * place wires.
 *
 * Pin layout: pins are split evenly between the left and right edges, in
 * order of declaration. Empty-string entries in `pins` skip a slot
 * (matches the Wokwi convention).
 */

const PIN_PITCH = 20;          // px between adjacent pins
const PIN_INSET = 0;           // pin x-offset from chip edge
const CHIP_PAD_Y = 14;         // top/bottom margin for first/last pin
const CHIP_MIN_W = 84;
const CHIP_MIN_H = 60;

interface PinInfo {
  name: string;
  x: number;
  y: number;
  signals?: string[];
}

class VelxioCustomChip extends HTMLElement {
  private _chipJson: string =
    '{"name":"Custom Chip","pins":["IN","OUT","GND","VCC"]}';
  private _chipName: string = 'Custom Chip';
  private _pinInfo: PinInfo[] = [];

  static get observedAttributes(): string[] {
    return ['chip-json', 'chip-name'];
  }

  set chipJson(v: string) {
    this._chipJson = v ?? '';
    this._render();
  }
  get chipJson(): string {
    return this._chipJson;
  }

  set chipName(v: string) {
    this._chipName = v ?? 'Custom Chip';
    this._render();
  }
  get chipName(): string {
    return this._chipName;
  }

  /** Contract consumed by DynamicComponent.tsx and PinOverlay.tsx. */
  get pinInfo(): PinInfo[] {
    return this._pinInfo;
  }

  attributeChangedCallback(name: string, _old: string, value: string): void {
    if (name === 'chip-json') this.chipJson = value;
    if (name === 'chip-name') this.chipName = value;
  }

  connectedCallback(): void {
    this._render();
  }

  /**
   * Parse the `pins` array. Each entry can be:
   *   - a string (Wokwi-compatible) — pin name, auto-laid out left/right.
   *   - an object {name, x, y} — explicit position relative to chip body.
   * Empty strings are slots to skip.
   */
  private _parsePins(): Array<{ name: string; x?: number; y?: number }> {
    try {
      const obj = JSON.parse(this._chipJson || '{}');
      if (Array.isArray(obj.pins)) {
        return obj.pins.map((p: unknown) => {
          if (typeof p === 'string') return { name: p };
          if (p && typeof p === 'object') {
            const o = p as any;
            return {
              name: String(o.name ?? ''),
              x: typeof o.x === 'number' ? o.x : undefined,
              y: typeof o.y === 'number' ? o.y : undefined,
            };
          }
          return { name: '' };
        });
      }
    } catch { /* ignore */ }
    return [];
  }

  /** Read optional `display: { width, height }` from chip.json. */
  private _parseDisplay(): { width: number; height: number } | null {
    try {
      const obj = JSON.parse(this._chipJson || '{}');
      if (obj.display && typeof obj.display.width === 'number' && typeof obj.display.height === 'number') {
        return { width: obj.display.width, height: obj.display.height };
      }
    } catch { /* ignore */ }
    return null;
  }

  private _layout(
    pins: Array<{ name: string; x?: number; y?: number }>,
    display: { width: number; height: number } | null,
  ): {
    width: number;
    height: number;
    placed: Array<{ name: string; x: number; y: number }>;
  } {
    const explicit = pins.filter((p) => p.x !== undefined && p.y !== undefined);
    const auto = pins.filter((p) => p.x === undefined || p.y === undefined);

    const half = Math.ceil(auto.length / 2);
    const left = auto.slice(0, half);
    const right = auto.slice(half);
    const placed: Array<{ name: string; x: number; y: number }> = [];

    const tallest = Math.max(left.length, right.length);
    const longestLabel = Math.max(
      ...auto.map((p) => p.name.length),
      this._chipName.length / 2,
      0,
    );
    let width = Math.max(CHIP_MIN_W, 36 + longestLabel * 8);
    let height = Math.max(CHIP_MIN_H, CHIP_PAD_Y * 2 + Math.max(0, tallest - 1) * PIN_PITCH);

    // If a display is configured, expand the chip body to fit it.
    if (display) {
      width = Math.max(width, display.width + 16);
      height = Math.max(height, display.height + 28); // top label + display + bottom margin
    }

    for (const p of explicit) {
      if (p.x !== undefined && p.x + 8 > width) width = p.x + 8;
      if (p.y !== undefined && p.y + 8 > height) height = p.y + 8;
    }

    left.forEach((p, i) => {
      if (!p.name) return;
      placed.push({ name: p.name, x: PIN_INSET, y: CHIP_PAD_Y + i * PIN_PITCH });
    });
    right.forEach((p, i) => {
      if (!p.name) return;
      placed.push({ name: p.name, x: width - PIN_INSET, y: CHIP_PAD_Y + i * PIN_PITCH });
    });
    explicit.forEach((p) => {
      if (!p.name) return;
      placed.push({ name: p.name, x: p.x!, y: p.y! });
    });

    return { width, height, placed };
  }

  /** Internal canvas used to render framebuffer pixels (when display is configured). */
  private _displayCanvas: HTMLCanvasElement | null = null;

  /** Re-paint the framebuffer canvas with RGBA bytes from the chip. */
  paintFramebuffer(rgba: Uint8Array, width: number, height: number): void {
    if (!this._displayCanvas) return;
    const ctx = this._displayCanvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    img.data.set(rgba.subarray(0, width * height * 4));
    ctx.putImageData(img, 0, 0);
  }

  private _render(): void {
    const pins = this._parsePins();
    const display = this._parseDisplay();
    const { width, height, placed } = this._layout(pins, display);

    this._pinInfo = placed.map((p) => ({ name: p.name, x: p.x, y: p.y, signals: [] }));

    this.style.display = 'inline-block';
    this.style.width = `${width}px`;
    this.style.height = `${height}px`;

    const pinsSvg = placed
      .map((p) => {
        const labelX = p.x < width / 2 ? p.x + 10 : p.x - 10;
        const anchor = p.x < width / 2 ? 'start' : 'end';
        return (
          `<g><rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" fill="#c0c0c0"/>` +
          `<text x="${labelX}" y="${p.y}" text-anchor="${anchor}" font-family="monospace" font-size="8" fill="#aaa" dominant-baseline="middle">${escapeText(p.name)}</text></g>`
        );
      })
      .join('');

    // Center the display (if any) horizontally; pad it 16px from top so the
    // chip name sits above (or beside, in narrow chips).
    const displaySvg = display
      ? `<foreignObject x="${(width - display.width) / 2}" y="16" width="${display.width}" height="${display.height}">
           <canvas xmlns="http://www.w3.org/1999/xhtml" data-display="1"
                   width="${display.width}" height="${display.height}"
                   style="image-rendering:pixelated;background:#000;display:block"></canvas>
         </foreignObject>`
      : '';

    const labelY = display ? 12 : height / 2;
    this.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="${width}" height="${height}"
           viewBox="0 0 ${width} ${height}">
        <rect x="6" y="2" width="${width - 12}" height="${height - 4}"
              rx="3" ry="3"
              fill="#1a1a1a" stroke="#444" stroke-width="1.5"/>
        <text x="${width / 2}" y="${labelY}"
              text-anchor="middle" dominant-baseline="middle"
              font-family="monospace" font-size="${display ? 9 : 11}" fill="#e0e0e0"
              font-weight="bold">${escapeText(this._chipName)}</text>
        ${displaySvg}
        ${pinsSvg}
      </svg>
    `;

    this._displayCanvas = display
      ? (this.querySelector('canvas[data-display="1"]') as HTMLCanvasElement | null)
      : null;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (typeof customElements !== 'undefined' && !customElements.get('velxio-custom-chip')) {
  customElements.define('velxio-custom-chip', VelxioCustomChip);
}

// React JSX intrinsic typing
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'velxio-custom-chip': any;
    }
  }
}
