/**
 * EPaper — React wrapper around the `<velxio-epaper>` Web Component.
 *
 * Same shape as PiPicoW.tsx / Esp32.tsx: renders the custom element and
 * forwards `panel-kind` + `refresh-ms` props to attributes. The wire
 * system reads `pinInfo` directly from the rendered DOM node — see
 * `EPaperElement.ts`.
 */

import './EPaperElement';

interface EPaperProps {
  id?: string;
  x?: number;
  y?: number;
  panelKind?: string;
  refreshMs?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'velxio-epaper': any;
    }
  }
}

export const EPaper = ({
  id = 'epaper',
  x = 0,
  y = 0,
  panelKind = 'epaper-1in54-bw',
  refreshMs,
}: EPaperProps) => (
  <velxio-epaper
    id={id}
    panel-kind={panelKind}
    refresh-ms={refreshMs}
    style={{ position: 'absolute', left: `${x}px`, top: `${y}px` }}
  />
);
