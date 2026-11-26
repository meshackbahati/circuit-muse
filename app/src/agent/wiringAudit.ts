/**
 * Wiring audit shared by the agent tools and the completion gate.
 *
 * The previous `check_wiring` implementation only asked whether a component
 * appeared in at least one wire. That let a two-pin LED with a single wire, a
 * module with power but no ground, and a board with no common ground all pass
 * as "connected", after which the agent compiled firmware that could not work.
 * This audit treats a part as complete only when it has enough distinct pins
 * connected for its type, and when every wire endpoint resolves to a real part
 * and a real pin.
 */

export interface WiringAuditInput {
  boards: Array<{ id: string; boardKind: string; name?: string }>;
  components: Array<{ id: string; metadataId: string; properties?: Record<string, unknown> }>;
  wires: Array<{
    id: string;
    start: { componentId: string; pinName: string };
    end: { componentId: string; pinName: string };
  }>;
}

export interface WiringIssue {
  component_id?: string;
  type?: string;
  reason: string;
  missing_pins?: string[];
  connected_pins?: string[];
}

export interface WiringAuditResult {
  complete: boolean;
  wire_count: number;
  blocking_issues: WiringIssue[];
  warnings: WiringIssue[];
  unconnected_components: WiringIssue[];
  incomplete_components: WiringIssue[];
  orphan_wires: Array<{ wire_id: string; reason: string }>;
  boards_without_ground: string[];
  next_actions: string[];
  wires: Array<{
    id: string;
    from_part: string;
    from_pin: string;
    to_part: string;
    to_pin: string;
  }>;
}

const POWER_PIN = /^(VCC|VDD|V\+|5V|3V3|3\.3V|VIN|VBUS|VSYS|VUSB)$/i;
const GROUND_PIN = /^(GND|GND\.\d+|VSS|0V)$/i;
const OPTIONAL_PIN = /^(NC|N\.C\.|RESERVED|MOUNT|MP|PAD|EP|XDA|XCL|AD0|INT|CSB|SDO|DOUT|V0|RW)$/i;

interface RequiredPinRule {
  match: RegExp;
  /** Every one of these pins must be connected. */
  pins?: string[];
  /** At least one of these pins must be connected. */
  anyOf?: string[];
  /** At least one pin from each group must be connected. */
  groups?: string[][];
}

const numeric = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

/**
 * Required pins for parts whose pin names are verified against the shipped
 * web components. Optional pins are deliberately excluded: an MPU6050 does
 * not need XDA or INT to work, a DS1307 does not need SQW, and a relay does
 * not need a switched contact merely to be driven. Parts without an entry
 * fall back to the DOM pin list and the two-distinct-pin rule, which avoids
 * blocking a part whose exact pinout this table has not learned yet.
 */
const REQUIRED_PINS: RequiredPinRule[] = [
  { match: /^led$/, pins: ['A', 'C'] },
  { match: /^rgb-led$/, pins: ['R', 'G', 'B', 'COM'] },
  { match: /^led-bar-graph$/, groups: [numeric('A', 10), numeric('C', 10)] },
  { match: /^led-ring$/, pins: ['GND', 'VCC', 'DIN'] },
  { match: /^resistor(-|$)/, pins: ['1', '2'] },
  { match: /^buzzer$/, pins: ['1', '2'] },
  { match: /^slide-switch$/, pins: ['2'], anyOf: ['1', '3'] },
  { match: /^tilt-switch$/, pins: ['GND', 'VCC', 'OUT'] },
  {
    match: /^dip-switch-8$/,
    groups: [
      Array.from({ length: 8 }, (_, index) => `${index + 1}a`),
      Array.from({ length: 8 }, (_, index) => `${index + 1}b`),
    ],
  },
  { match: /^potentiometer$|^slide-potentiometer$/, pins: ['VCC', 'GND', 'SIG'] },
  { match: /^servo$/, pins: ['GND', 'V+', 'PWM'] },
  { match: /^dht22$/, pins: ['VCC', 'GND', 'SDA'] },
  { match: /^hc-sr04$/, pins: ['VCC', 'GND', 'TRIG', 'ECHO'] },
  { match: /^mpu6050$|^bmp280$/, pins: ['VCC', 'GND', 'SCL', 'SDA'] },
  { match: /^big-sound-sensor$|^small-sound-sensor$/, pins: ['VCC', 'GND', 'AOUT'] },
  { match: /^lcd1602-i2c$|^lcd2004-i2c$/, pins: ['VCC', 'GND', 'SCL', 'SDA'] },
  {
    match: /^lcd1602$|^lcd2002$|^lcd2004$/,
    pins: ['RS', 'E'],
    groups: [['VSS', 'GND'], ['VDD', 'VCC']],
    anyOf: ['D4', 'D5', 'D6', 'D7'],
  },
  { match: /^neopixel$/, pins: ['VDD', 'VSS', 'DIN'] },
  { match: /^neopixel-matrix$/, pins: ['GND', 'VCC', 'DIN'] },
  { match: /^relay$/, pins: ['COIL+', 'COIL-'] },
  { match: /^7segment$/, pins: ['COM'], anyOf: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  { match: /^membrane-keypad$/, anyOf: ['R1', 'R2', 'C1', 'C2'] },
  { match: /^microsd-card$/, pins: ['VCC', 'GND', 'SCK', 'CS', 'DI', 'DO'] },
  { match: /^ds1307$/, pins: ['5V', 'GND', 'SDA', 'SCL'] },
  { match: /^a4988$/, pins: ['VDD', 'GND', 'STEP', 'DIR'] },
  { match: /^74hc595$/, pins: ['VCC', 'GND', 'DS', 'SHCP', 'STCP'] },
];

function normalizePin(pin: string): string {
  return String(pin ?? '').trim();
}

function pinsForPart(
  component: WiringAuditInput['components'][number],
  domPins: string[] | null,
): { required: string[]; anyOf: string[]; groups: string[][]; known: boolean } {
  const id = String(component.metadataId ?? '').toLowerCase();
  const rule = REQUIRED_PINS.find((entry) => entry.match.test(id));
  if (rule) {
    return {
      required: rule.pins ?? [],
      anyOf: rule.anyOf ?? [],
      groups: rule.groups ?? [],
      known: true,
    };
  }
  if (domPins && domPins.length > 0) {
    const useful = domPins.filter((pin) => !OPTIONAL_PIN.test(pin));
    if (useful.length <= 2) {
      return { required: useful, anyOf: [], groups: [], known: true };
    }
    return { required: [], anyOf: useful, groups: [], known: true };
  }
  return { required: [], anyOf: [], groups: [], known: false };
}

function domPinNames(componentId: string): string[] | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(componentId) as
    | { pinInfo?: Array<{ name?: string }> }
    | null;
  const info = element?.pinInfo;
  if (!Array.isArray(info)) return null;
  const names = info
    .map((pin) => normalizePin(pin?.name ?? ''))
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : null;
}

export function boardPinExists(boardKind: string, pinName: string): boolean {
  const value = normalizePin(pinName);
  if (!value) return false;
  if (GROUND_PIN.test(value) || POWER_PIN.test(value)) return true;
  if (/^(GND|VCC|VIN|IOREF|AREF|RESET|3\.3V|3V3|5V|3V)/i.test(value)) return true;
  if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano') {
    if (/^D?\d{1,2}$/i.test(value)) return true;
    return /^A\d$/i.test(value);
  }
  if (boardKind === 'arduino-mega') {
    if (/^D?\d{1,2}$/i.test(value)) return true;
    return /^A\d{1,2}$/i.test(value);
  }
  if (boardKind.includes('pico') || boardKind.includes('rp2040')) {
    return /^(GP)?\d{1,2}$/i.test(value) || /^D\d{1,2}$/i.test(value) || /^A\d$/i.test(value) || /^(TX|RX|ADC\d|RUN|SWCLK|SWDIO|SDA|SCL|MOSI|MISO|SCK|CS)$/i.test(value);
  }
  if (boardKind.includes('esp32')) {
    return /^(GPIO)?\d{1,2}$/i.test(value) || /^D\d{1,2}$/i.test(value) || /^A\d{1,2}$/i.test(value) || /^(TX\d*|RX\d*|SDA|SCL|MOSI|MISO|SCK|SS|VP|VN|EN)$/i.test(value);
  }
  if (boardKind.includes('stm32')) {
    return /^P[A-Z]\d{1,2}$/i.test(value) || /^(PA|PB|PC)\d{1,2}$/i.test(value) || /^D\d{1,2}$/i.test(value) || /^A\d{1,2}$/i.test(value);
  }
  if (boardKind.includes('raspberry-pi')) {
    return /^\d{1,2}$/.test(value) || /^(GPIO\d+|SDA|SCL|TX|RX|MOSI|MISO|SCLK|CE0|CE1)$/i.test(value);
  }
  // Unknown board kinds are accepted rather than blocked: a false wiring
  // failure is worse than a missing pin warning on a board this table has
  // not learned yet.
  return value.length > 0;
}

export function auditWiring(input: WiringAuditInput): WiringAuditResult {
  const boardIds = new Set(input.boards.map((board) => board.id));
  const componentIds = new Set(input.components.map((component) => component.id));
  const knownParts = new Set<string>([...boardIds, ...componentIds]);
  const wires = input.wires ?? [];
  const connectedByPart = new Map<string, Set<string>>();
  const wireIds = new Set<string>();
  const blocking: WiringIssue[] = [];
  const warnings: WiringIssue[] = [];
  const orphanWires: Array<{ wire_id: string; reason: string }> = [];

  for (const wire of wires) {
    const wireId = String(wire.id ?? '');
    if (wireId && wireIds.has(wireId)) {
      warnings.push({ reason: `Duplicate wire id ${wireId}; keep ids unique so remove_wire targets one wire.` });
    }
    wireIds.add(wireId);

    const fromId = wire.start?.componentId;
    const toId = wire.end?.componentId;
    const fromPin = normalizePin(wire.start?.pinName);
    const toPin = normalizePin(wire.end?.pinName);
    if (!fromId || !toId || !fromPin || !toPin) {
      orphanWires.push({ wire_id: wireId, reason: 'Wire has an empty endpoint.' });
      continue;
    }
    if (fromId === toId && fromPin === toPin) {
      blocking.push({ reason: `Wire ${wireId} connects ${fromId}:${fromPin} to itself.` });
      continue;
    }
    if (!knownParts.has(fromId)) {
      orphanWires.push({ wire_id: wireId, reason: `Missing part ${fromId} on the from endpoint.` });
      continue;
    }
    if (!knownParts.has(toId)) {
      orphanWires.push({ wire_id: wireId, reason: `Missing part ${toId} on the to endpoint.` });
      continue;
    }

    const fromBoard = input.boards.find((board) => board.id === fromId);
    if (fromBoard && !boardPinExists(fromBoard.boardKind, fromPin)) {
      blocking.push({
        component_id: fromId,
        type: fromBoard.boardKind,
        reason: `Board pin ${fromPin} does not exist on ${fromBoard.boardKind}.`,
        connected_pins: [fromPin],
      });
    }
    const toBoard = input.boards.find((board) => board.id === toId);
    if (toBoard && !boardPinExists(toBoard.boardKind, toPin)) {
      blocking.push({
        component_id: toId,
        type: toBoard.boardKind,
        reason: `Board pin ${toPin} does not exist on ${toBoard.boardKind}.`,
        connected_pins: [toPin],
      });
    }

    for (const [partId, pin] of [
      [fromId, fromPin],
      [toId, toPin],
    ] as const) {
      if (!connectedByPart.has(partId)) connectedByPart.set(partId, new Set());
      connectedByPart.get(partId)!.add(pin);
    }
  }

  const unconnected: WiringIssue[] = [];
  const incomplete: WiringIssue[] = [];

  for (const component of input.components) {
    const connected = connectedByPart.get(component.id) ?? new Set<string>();
    if (connected.size === 0) {
      const issue = {
        component_id: component.id,
        type: component.metadataId,
        reason: `${component.metadataId} ${component.id} has no wires.`,
        connected_pins: [],
      };
      unconnected.push(issue);
      blocking.push(issue);
      continue;
    }

    const domPins = domPinNames(component.id);
    const { required, anyOf, groups, known } = pinsForPart(component, domPins);

    if (connected.size < 2) {
      const missingPins = known
        ? [
            ...required.filter((pin) => !connected.has(pin)),
            ...(anyOf.length > 0 && !anyOf.some((pin) => connected.has(pin)) ? anyOf : []),
            ...groups
              .filter((group) => !group.some((pin) => connected.has(pin)))
              .map((group) => `one of ${group.join(' or ')}`),
          ]
        : [];
      const issue = {
        component_id: component.id,
        type: component.metadataId,
        reason: `${component.metadataId} ${component.id} has only one pin wired (${[...connected].join(', ')}); a two-terminal part needs both terminals.`,
        missing_pins: missingPins,
        connected_pins: [...connected],
      };
      incomplete.push(issue);
      blocking.push(issue);
      continue;
    }

    // Pushbuttons are four pins that form two internally connected pairs.
    // Two wires on the same side do nothing, so require one from each side.
    if (/^pushbutton/.test(component.metadataId)) {
      const hasLeft = [...connected].some((pin) => /\.l$/i.test(pin) || /^l/i.test(pin));
      const hasRight = [...connected].some((pin) => /\.r$/i.test(pin) || /^r/i.test(pin));
      const plain = [...connected].filter((pin) => !/\.(l|r)$/i.test(pin));
      if ((hasLeft && !hasRight) || (hasRight && !hasLeft) || (plain.length === 1 && !hasLeft && !hasRight)) {
        const issue = {
          component_id: component.id,
          type: component.metadataId,
          reason: `Pushbutton ${component.id} is wired on only one contact side; connect one pin from each side (for example 1.l to a GPIO and 2.l to ground).`,
          connected_pins: [...connected],
        };
        incomplete.push(issue);
        blocking.push(issue);
        continue;
      }
    }

    if (component.metadataId === 'membrane-keypad' && connected.size < 4) {
      const issue = {
        component_id: component.id,
        type: component.metadataId,
        reason: `Keypad ${component.id} needs at least four connections (two rows and two columns); only ${connected.size} are wired.`,
        connected_pins: [...connected],
      };
      incomplete.push(issue);
      blocking.push(issue);
      continue;
    }

    const missing = required.filter((pin) => !connected.has(pin));
    const hasAnyOf = anyOf.length === 0 || anyOf.some((pin) => connected.has(pin));
    const missingGroups = groups.filter((group) => !group.some((pin) => connected.has(pin)));

    if (known && (missing.length > 0 || !hasAnyOf || missingGroups.length > 0)) {
      const missingList = [
        ...missing,
        ...(hasAnyOf ? [] : anyOf),
        ...missingGroups.map((group) => `one of ${group.join(' or ')}`),
      ];
      const issue = {
        component_id: component.id,
        type: component.metadataId,
        reason: `${component.metadataId} ${component.id} is missing required pin connections: ${missingList.join(', ')}.`,
        missing_pins: missingList,
        connected_pins: [...connected],
      };
      incomplete.push(issue);
      blocking.push(issue);
      continue;
    }

    const hasPower = [...connected].some((pin) => POWER_PIN.test(pin));
    const hasGround = [...connected].some((pin) => GROUND_PIN.test(pin));
    if (hasPower && !hasGround) {
      const issue = {
        component_id: component.id,
        type: component.metadataId,
        reason: `${component.metadataId} ${component.id} has power wired but no ground.`,
        connected_pins: [...connected],
      };
      incomplete.push(issue);
      blocking.push(issue);
      continue;
    }
    if (hasGround && !hasPower && /^(dht|bmp|mpu|ssd|lcd|servo|relay|neopixel|microsd|ds1|ds3|pcf|a4988|74hc)/i.test(component.metadataId)) {
      warnings.push({
        component_id: component.id,
        type: component.metadataId,
        reason: `${component.metadataId} ${component.id} has ground wired but no supply pin.`,
        connected_pins: [...connected],
      });
    }
  }

  // A board with external parts must share a ground with them. Without this
  // check the agent could wire a sensor's signal pin and its VCC to the board
  // but leave the ground floating, which reads as a dead input at runtime.
  const boardsWithoutGround: string[] = [];
  if (input.components.length > 0) {
    for (const board of input.boards) {
      const boardPins = connectedByPart.get(board.id) ?? new Set<string>();
      if (boardPins.size === 0) continue;
      const hasGround = [...boardPins].some((pin) => GROUND_PIN.test(pin));
      if (!hasGround) {
        boardsWithoutGround.push(board.id);
        blocking.push({
          component_id: board.id,
          type: board.boardKind,
          reason: `Board ${board.id} has wires but no ground connection. Connect a board GND pin to the common ground.`,
          connected_pins: [...boardPins],
        });
      }
    }
  }

  const nextActions: string[] = [];
  if (unconnected.length > 0) {
    nextActions.push(
      `Wire every unconnected part: ${unconnected.map((issue) => `${issue.component_id} (${issue.type})`).join(', ')}.`,
    );
  }
  if (incomplete.length > 0) {
    nextActions.push(
      `Complete the missing pins: ${incomplete
        .map((issue) => `${issue.component_id}: ${(issue.missing_pins ?? []).join(', ') || issue.reason}`)
        .join('; ')}.`,
    );
  }
  if (orphanWires.length > 0) {
    nextActions.push(`Remove or repair orphan wires: ${orphanWires.map((wire) => wire.wire_id).join(', ')}.`);
  }
  if (boardsWithoutGround.length > 0) {
    nextActions.push(`Connect ground on boards: ${boardsWithoutGround.join(', ')}.`);
  }
  if (nextActions.length === 0) {
    nextActions.push('Wiring is complete. Verify the circuit, then compile and run.');
  }

  return {
    complete: blocking.length === 0,
    wire_count: wires.length,
    blocking_issues: blocking,
    warnings,
    unconnected_components: unconnected,
    incomplete_components: incomplete,
    orphan_wires: orphanWires,
    boards_without_ground: boardsWithoutGround,
    next_actions: nextActions,
    wires: wires.map((wire) => ({
      id: wire.id,
      from_part: wire.start.componentId,
      from_pin: wire.start.pinName,
      to_part: wire.end.componentId,
      to_pin: wire.end.pinName,
    })),
  };
}

export function wiringSummary(result: WiringAuditResult): string {
  if (result.complete) {
    return `Wiring complete: ${result.wire_count} wires, no dangling parts.`;
  }
  return [
    `Wiring incomplete: ${result.blocking_issues.length} blocking issue(s).`,
    ...result.next_actions,
  ].join(' ');
}
