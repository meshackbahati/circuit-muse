/**
 * Raspberry Pi 5 React wrapper — renders the velxio-raspberry-pi-5 custom
 * element at an absolute position.  Pin info lives on the custom element
 * via its `pinInfo` getter; the wire system reads it from the DOM.
 */
import './RaspberryPi5Element';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'velxio-raspberry-pi-5': any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
}

interface RaspberryPi5Props {
  id?: string;
  x?: number;
  y?: number;
}

export const RaspberryPi5 = ({ id = 'raspberry-pi-5', x = 0, y = 0 }: RaspberryPi5Props) => (
  <velxio-raspberry-pi-5
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
