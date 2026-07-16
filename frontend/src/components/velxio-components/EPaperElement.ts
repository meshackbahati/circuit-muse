/**
 * EPaperElement — `<velxio-epaper>` Web Component for SSD168x ePaper panels.
 *
 * One element class shared by all five Phase-1 panel variants
 * (1.54", 2.13", 2.9", 4.2", 7.5"). Differences are encoded in the
 * `panel-kind` attribute and resolved via `EPaperPanels.PANEL_CONFIGS`.
 *
 * Per CLAUDE.md §6a: this MUST be a real Web Component — `pinInfo` is read
 * by the wire system from the DOM. The getter is intentionally **not
 * memoized** so a runtime change of `panel-kind` (e.g. via the property
 * dialog) re-resolves to the right pin coordinates.
 *
 * Public surface:
 *   element.canvas         → the inner <canvas> for putImageData()
 *   element.busy           → boolean; flips the visual "refreshing" overlay
 *   element.refreshMs      → number; how long BUSY stays high (default cfg.refreshMs)
 *   event 'canvas-ready'   → fires when the canvas DOM node first exists
 */

import {
  PANEL_CONFIGS,
  DEFAULT_PANEL_KIND,
  getPanelConfig,
  type EPaperPanelConfig,
} from '../../simulation/displays/EPaperPanels';

const STANDARD_PIN_NAMES = ['GND', 'VCC', 'SCK', 'SDI', 'CS', 'DC', 'RST', 'BUSY'] as const;
const PIN_SPACING = 14; // CSS px between FPC pins

class EPaperElement extends HTMLElement {
  private _busy = false;
  private _refreshMs = 50;

  static get observedAttributes(): string[] {
    return ['panel-kind', 'refresh-ms'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    // Defer to next microtask so listeners (the simulation hook) attach before
    // we fire — same pattern used by wokwi-ili9341.
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('canvas-ready', { bubbles: false }));
    });
  }

  attributeChangedCallback(name: string): void {
    if (name === 'panel-kind') {
      this.render();
    } else if (name === 'refresh-ms') {
      const v = parseFloat(this.getAttribute('refresh-ms') ?? '');
      if (!isNaN(v) && v > 0) this._refreshMs = v;
    }
  }

  // ── Public properties ─────────────────────────────────────────────────────

  /** Wire system reads this; do NOT memoize — see header. */
  get pinInfo() {
    const cfg = this.config;
    // FPC tail starts horizontally centred in the body footer.
    const baseX = (cfg.bodyW - STANDARD_PIN_NAMES.length * PIN_SPACING) / 2 + PIN_SPACING / 2;
    const y = cfg.bodyH;
    return STANDARD_PIN_NAMES.map((name, i) => ({
      name,
      x: baseX + i * PIN_SPACING,
      y,
      number: i + 1,
      signals:
        name === 'VCC'
          ? [{ type: 'power', signal: 'VCC' }]
          : name === 'GND'
            ? [{ type: 'power', signal: 'GND' }]
            : [],
    }));
  }

  /** Returned by the simulation hook for putImageData. */
  get canvas(): HTMLCanvasElement | null {
    return this.shadowRoot?.querySelector('canvas') ?? null;
  }

  /** Active panel config. */
  get config(): EPaperPanelConfig {
    return getPanelConfig(this.getAttribute('panel-kind'));
  }

  set busy(v: boolean) {
    if (v === this._busy) return;
    this._busy = v;
    this.updateBusyOverlay();
  }
  get busy(): boolean {
    return this._busy;
  }

  /**
   * Mirror `panel-kind` as a property so DynamicComponent's
   * `element[key] = value` assignment path works (it iterates JSON
   * `properties` and writes them as element properties, not attributes).
   * Setting either form re-renders.
   */
  set panelKind(v: string) {
    if (typeof v === 'string' && v && v !== this.getAttribute('panel-kind')) {
      this.setAttribute('panel-kind', v);
    }
  }
  get panelKind(): string {
    return this.getAttribute('panel-kind') ?? '';
  }

  set refreshMs(v: number) {
    if (v > 0) this._refreshMs = v;
  }
  get refreshMs(): number {
    const attr = parseFloat(this.getAttribute('refresh-ms') ?? '');
    if (!isNaN(attr) && attr > 0) return attr;
    return this._refreshMs || this.config.refreshMs;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.shadowRoot) return;
    const cfg = this.config;

    // Active area position: centred horizontally, top of body + bezel.
    const ax = (cfg.bodyW - cfg.width) / 2;
    const ay = cfg.bezelPx;

    // Draw the FPC tail along the bottom centre.
    const tailX = (cfg.bodyW - STANDARD_PIN_NAMES.length * PIN_SPACING) / 2;
    const tailY = cfg.bodyH - cfg.fpcStripPx;
    const tailW = STANDARD_PIN_NAMES.length * PIN_SPACING;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; position: relative; }
        .panel { display: block; user-select: none; -webkit-user-select: none; }
        canvas {
          position: absolute;
          left: ${ax}px;
          top: ${ay}px;
          image-rendering: pixelated;
          background: #f4f1e8;  /* off-white "paper" idle colour */
          pointer-events: none;
        }
        .busy-overlay {
          position: absolute;
          left: ${ax}px; top: ${ay}px;
          width: ${cfg.width}px; height: ${cfg.height}px;
          background: linear-gradient(90deg,
            rgba(255,255,255,0) 0%,
            rgba(255,255,255,0.6) 50%,
            rgba(255,255,255,0) 100%);
          opacity: 0;
          transition: opacity 0.15s linear;
          pointer-events: none;
          background-size: 200% 100%;
          animation: busyflash 1.2s linear infinite;
        }
        :host([data-busy="true"]) .busy-overlay { opacity: 1; }
        @keyframes busyflash {
          0%   { background-position: -100% 0; }
          100% { background-position:  100% 0; }
        }
        .label {
          font-family: 'Cascadia Code','Fira Code','Consolas',monospace;
          fill: #6a6a6a; text-anchor: middle; user-select: none;
        }
      </style>

      <svg class="panel" width="${cfg.bodyW}" height="${cfg.bodyH}"
           viewBox="0 0 ${cfg.bodyW} ${cfg.bodyH}"
           xmlns="http://www.w3.org/2000/svg">
        <!-- Panel body (bezel + FPC) -->
        <rect x="0.5" y="0.5"
              width="${cfg.bodyW - 1}" height="${cfg.bodyH - 1}"
              rx="4" ry="4"
              fill="#e8e2d4" stroke="#b8aa90" stroke-width="1"/>

        <!-- Active area frame -->
        <rect x="${ax - 1}" y="${ay - 1}"
              width="${cfg.width + 2}" height="${cfg.height + 2}"
              fill="#f4f1e8" stroke="#a89a80" stroke-width="0.5"/>

        <!-- FPC connector strip -->
        <rect x="${tailX - 4}" y="${tailY}"
              width="${tailW + 8}" height="${cfg.fpcStripPx - 6}"
              fill="#d49a3c" stroke="#a47020" stroke-width="0.6" rx="1"/>

        <!-- FPC golden contacts (one per pin) -->
        ${STANDARD_PIN_NAMES.map(
          (_, i) => `
          <rect x="${tailX + i * PIN_SPACING + 3}"
                y="${tailY + 3}"
                width="${PIN_SPACING - 6}" height="${cfg.fpcStripPx - 12}"
                fill="#f3c557" stroke="#a47020" stroke-width="0.4"/>`,
        ).join('')}

        <!-- Pin labels (above the FPC tail, on the body) -->
        ${STANDARD_PIN_NAMES.map(
          (name, i) => `
          <text class="label" x="${tailX + i * PIN_SPACING + PIN_SPACING / 2}"
                y="${tailY - 2}" font-size="6">${name}</text>`,
        ).join('')}

        <!-- Model label centred just above the FPC -->
        <text class="label" x="${cfg.bodyW / 2}" y="${tailY - 12}"
              font-size="7" font-weight="600" fill="#5a5040">${cfg.controllerIc}</text>
      </svg>

      <canvas width="${cfg.width}" height="${cfg.height}"></canvas>
      <div class="busy-overlay"></div>
    `;
    this.updateBusyOverlay();
  }

  private updateBusyOverlay(): void {
    if (this._busy) this.setAttribute('data-busy', 'true');
    else this.removeAttribute('data-busy');
  }
}

if (!customElements.get('velxio-epaper')) {
  customElements.define('velxio-epaper', EPaperElement);
}

// Re-export so consumers can type-check.
export type { EPaperElement };

// Convenience: list every panel kind so other modules don't have to import
// from EPaperPanels.ts when they just need the registry IDs.
export const ALL_EPAPER_PANEL_KINDS = Object.keys(PANEL_CONFIGS);
