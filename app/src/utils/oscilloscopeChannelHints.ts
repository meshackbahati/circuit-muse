/**
 * Hints for the oscilloscope's first channel.
 *
 * Opening the scope previously picked the first wired pin, or pin 0 when
 * nothing was wired. A blink sketch using the built-in LED therefore produced
 * a channel on a pin that never changes, which rendered as "waiting for
 * signal" forever. Reading the sketch gives a concrete starting point and a
 * timebase that makes the first waveform visible without manual setup.
 */

export interface ChannelHints {
  /** Pin numbers the source appears to drive, in order of appearance. */
  pins: number[];
  /** Suggested milliseconds per division, or null when no delay is found. */
  timeDivMs: number | null;
}

const DIVISIONS = 10;
const TIME_DIV_OPTIONS = [0.1, 0.5, 1, 5, 10, 50, 100, 500];

function toPin(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === 'LED_BUILTIN') return 13;
  const pin = Number(trimmed);
  return Number.isInteger(pin) && pin >= 0 && pin <= 69 ? pin : null;
}

export function channelHints(source: string): ChannelHints {
  // Strip comments so commented-out writes do not create phantom channels.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  const pins: number[] = [];
  const seen = new Set<number>();
  const add = (pin: number | null) => {
    if (pin !== null && !seen.has(pin)) {
      seen.add(pin);
      pins.push(pin);
    }
  };

  for (const match of code.matchAll(/\b(?:digitalWrite|analogWrite|tone)\s*\(\s*([^,)]+)/g)) {
    add(toPin(match[1]));
  }
  // Pin mode declarations alone do not toggle, but they identify the pins the
  // sketch considers outputs and are useful when the write uses a variable.
  for (const match of code.matchAll(/\bpinMode\s*\(\s*([^,)]+)/g)) {
    add(toPin(match[1]));
  }

  const delays = [...code.matchAll(/\bdelay(?:Microseconds)?\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g)].map(
    (match) => Number(match[1]) / (match[0].startsWith('delayMicroseconds') ? 1000 : 1),
  );
  const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;
  const target = maxDelay / DIVISIONS;
  const timeDivMs = target > 0 ? TIME_DIV_OPTIONS.find((ms) => ms >= target) ?? 500 : null;

  return { pins, timeDivMs };
}

/**
 * Merge source hints with canvas wires. A wired pin that the sketch writes
 * is the best choice; a written pin with no wire (built-in LED) is next;
 * then a wired pin, then pin 13, then the first monitorable pin.
 */
export function chooseChannelPin(
  available: number[],
  wired: Set<string>,
  hints: number[],
): number | null {
  if (available.length === 0) return null;
  const availableSet = new Set(available);
  const isWired = (pin: number) =>
    wired.has(String(pin)) || wired.has(`D${pin}`) || wired.has(`A${pin}`);

  return (
    hints.find((pin) => availableSet.has(pin) && isWired(pin)) ??
    hints.find((pin) => availableSet.has(pin)) ??
    available.find((pin) => isWired(pin)) ??
    (availableSet.has(13) ? 13 : null) ??
    available[0]
  );
}
