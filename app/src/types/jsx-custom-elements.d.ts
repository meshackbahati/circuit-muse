// React 19 resolves JSX.IntrinsicElements from the react module, not the
// global JSX namespace. Declare the web-component wrappers used by the app
// there. Keep this to tags the global declarations do not already cover, so
// @wokwi/elements' concrete types stay in effect for its own components.
import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'circuit-muse-attiny85': any;
      'circuit-muse-epaper': any;
      'circuit-muse-esp32': any;
      'circuit-muse-pi-pico-w': any;
      'circuit-muse-raspberry-pi-4': any;
      'circuit-muse-raspberry-pi-5': any;
      'circuit-muse-stm32-bluepill': any;
      'circuit-muse-stm32-blackpill': any;
      'circuit-muse-stm32-bluepill-f103cb': any;
      'circuit-muse-stm32-blackpill-f401': any;
      'circuit-muse-stm32-f4-discovery': any;
      'circuit-muse-stm32-olimex-h405': any;
      'circuit-muse-stm32-netduino-plus2': any;
      'circuit-muse-stm32-netduino2': any;
      'wokwi-arduino-mega': any;
      'wokwi-arduino-nano': any;
      'wokwi-arduino-uno': any;
      'wokwi-led': any;
      'wokwi-potentiometer': any;
      'wokwi-pushbutton': any;
      'wokwi-resistor': any;
    }
  }
}
