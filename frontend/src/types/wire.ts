export interface WireEndpoint {
  componentId: string;
  pinName: string;
  x: number;
  y: number;
}

/**
 * Logical signal type carried by a wire. Used by `wireColors` for
 * visual coding and by `Interconnect` as a hint for cross-process
 * UART byte-level shortcuts.
 */
export type WireSignalType =
  | 'power-vcc'
  | 'power-gnd'
  | 'analog'
  | 'digital'
  | 'pwm'
  | 'i2c'
  | 'spi'
  | 'usart';

/** Map of every signal type to its display color. */
export type WireColorMap = Record<WireSignalType, string>;

export interface Wire {
  id: string;
  start: WireEndpoint;
  end: WireEndpoint;
  /** Intermediate waypoints clicked by the user during wire creation */
  waypoints: { x: number; y: number }[];
  color: string;
  /**
   * Optional logical signal classification (digital, i2c, usart, …).
   * Set by classifiers; absent on freshly-drawn wires until they are
   * resolved against board pin metadata.
   */
  signalType?: WireSignalType;
}

export interface WireInProgress {
  startEndpoint: WireEndpoint;
  waypoints: { x: number; y: number }[];
  color: string;
  currentX: number;
  currentY: number;
}
