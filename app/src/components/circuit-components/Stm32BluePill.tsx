import './Stm32BluePillElement';

interface Props {
  id: string;
  x: number;
  y: number;
}

/** Thin React wrappers over the STM32 board Web Components (rule 6a). */
export const Stm32BluePill = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-bluepill id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32BlackPill = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-blackpill id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32BluePillF103CB = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-bluepill-f103cb id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32BlackPillF401 = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-blackpill-f401 id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32F4Discovery = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-f4-discovery id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32OlimexH405 = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-olimex-h405 id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32NetduinoPlus2 = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-netduino-plus2 id={id} style={{ position: 'absolute', left: x, top: y }} />
);

export const Stm32Netduino2 = ({ id, x, y }: Props) => (
  <circuit-muse-stm32-netduino2 id={id} style={{ position: 'absolute', left: x, top: y }} />
);
