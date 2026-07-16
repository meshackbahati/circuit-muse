/**
 * Raspberry Pi 4 React wrapper — renders the velxio-raspberry-pi-4 custom
 * element (defined in RaspberryPi4Element.ts) at an absolute position so
 * BoardOnCanvas can drop it on the simulator canvas.  The wire system
 * reads `pinInfo` directly from the custom element via DOM, so no
 * additional pinInfo wiring is needed here.
 */
import './RaspberryPi4Element';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'velxio-raspberry-pi-4': any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
}

interface RaspberryPi4Props {
  id?: string;
  x?: number;
  y?: number;
}

export const RaspberryPi4 = ({ id = 'raspberry-pi-4', x = 0, y = 0 }: RaspberryPi4Props) => (
  <velxio-raspberry-pi-4
    id={id}
    style={{
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      display: 'block',
      userSelect: 'none',
      pointerEvents: 'none',
    }}
  />
);
