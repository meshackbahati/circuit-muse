/**
 * Fritzing .fzz file import.
 *
 * Fritzing files are ZIPs containing an XML sketch (.fz) with:
 * - <instances> — parts with breadboard positions
 * - <wires> — connections between part connectors
 * - <programs> — embedded Arduino code
 *
 * We parse the XML, map Fritzing part types to CircuitMuse component IDs,
 * extract wire connections, and return a loadable project state.
 */

import JSZip from 'jszip';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';

// ─── Fritzing part type → CircuitMuse metadataId mapping ──────────────────

const FRITZING_TO_CIRCUITMUSE: Record<string, string> = {
  // Boards
  'wokwi-arduino-uno': 'arduino-uno',
  'wokwi-arduino-nano': 'arduino-nano',
  'wokwi-arduino-mega': 'arduino-mega',
  'wokwi-pi-pico': 'raspberry-pi-pico',
  // Basic components
  'wokwi-led': 'wokwi-led',
  'wokwi-resistor': 'wokwi-resistor',
  'wokwi-capacitor': 'wokwi-capacitor',
  'wokwi-pushbutton': 'wokwi-pushbutton',
  'wokwi-slide-switch': 'wokwi-slide-switch',
  'wokwi-potentiometer': 'wokwi-potentiometer',
  // Sensors
  'wokwi-dht22': 'dht22',
  'wokwi-hcsr04': 'hc-sr04',
  'wokwi-mpu6050': 'mpu6050',
  'wokwi-bmp280': 'bmp280',
  // Displays
  'wokwi-lcd1602': 'wokwi-lcd1602',
  'wokwi-ssd1306': 'wokwi-ssd1306',
  // Output
  'wokwi-servo': 'wokwi-servo',
  'wokwi-buzzer': 'wokwi-buzzer',
  'wokwi-neopixel': 'wokwi-neopixel',
};

interface FritzingPart {
  id: string;
  moduleIdRef: string;
  x: number;
  y: number;
  rotation: number;
}

interface FritzingWire {
  fromPart: string;
  fromPin: string;
  toPart: string;
  toPin: string;
  color: string;
}

interface FritzingImportResult {
  boardType: string;
  parts: FritzingPart[];
  wires: FritzingWire[];
  code: string;
  libraries: string[];
}

// ─── XML Parsing Helpers ──────────────────────────────────────────────────

function parseXml(text: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(text, 'text/xml');
}

function getAttr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function getNum(el: Element, name: string, fallback = 0): number {
  const v = parseFloat(getAttr(el, name));
  return isNaN(v) ? fallback : v;
}

// ─── Main Import Function ─────────────────────────────────────────────────

export async function importFritzingFile(file: File): Promise<FritzingImportResult> {
  const zip = await JSZip.loadAsync(file);

  // Find the .fz file (the sketch XML)
  const fzFile = Object.keys(zip.files).find(
    (name) => name.endsWith('.fz') && !name.startsWith('__MACOSX'),
  );
  if (!fzFile) {
    throw new Error('No Fritzing sketch (.fz) found in the ZIP');
  }

  const xmlText = await zip.file(fzFile)!.async('text');
  const doc = parseXml(xmlText);

  // Extract parts from the breadboard view
  const parts: FritzingPart[] = [];
  const partElements = doc.querySelectorAll('instance');
  for (const el of Array.from(partElements)) {
    const moduleId = getAttr(el, 'moduleIdRef');
    const id = getAttr(el, 'id');
    // Get breadboard view transform
    const views = el.querySelectorAll('views');
    let x = 0, y = 0, rotation = 0;
    for (const viewEl of Array.from(views)) {
      const bb = viewEl.querySelector('breadboardView');
      if (bb) {
        const svg = bb.querySelector('svg');
        if (svg) {
          const transform = getAttr(svg, 'transform');
          // Parse "translate(x, y) rotate(r)" from transform
          const translateMatch = transform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
          if (translateMatch) {
            x = parseFloat(translateMatch[1]);
            y = parseFloat(translateMatch[2]);
          }
          const rotateMatch = transform.match(/rotate\(([-\d.]+)\)/);
          if (rotateMatch) {
            rotation = parseFloat(rotateMatch[1]);
          }
        }
      }
    }

    parts.push({
      id,
      moduleIdRef: moduleId,
      x: x * 0.75, // Fritzing uses different scale
      y: y * 0.75,
      rotation,
    });
  }

  // Extract wires
  const wires: FritzingWire[] = [];
  const wireElements = doc.querySelectorAll('wire');
  for (const el of Array.from(wireElements)) {
    const fromPart = getAttr(el, 'fromPart');
    const fromPin = getAttr(el, 'fromConnectorId');
    const toPart = getAttr(el, 'toPart');
    const toPin = getAttr(el, 'toConnectorId');
    const color = getAttr(el, 'color') || 'green';

    if (fromPart && fromPin && toPart && toPin) {
      wires.push({ fromPart, fromPin, toPart, toPin, color });
    }
  }

  // Extract code from <programs> section
  let code = '';
  const programElements = doc.querySelectorAll('program');
  for (const el of Array.from(programElements)) {
    const codeEl = el.querySelector('code');
    if (codeEl) {
      code = codeEl.textContent ?? '';
      break;
    }
  }

  // Also check for .ino files in the ZIP
  if (!code) {
    const inoFile = Object.keys(zip.files).find(
      (name) => name.endsWith('.ino') && !name.startsWith('__MACOSX'),
    );
    if (inoFile) {
      code = await zip.file(inoFile)!.async('text');
    }
  }

  // Extract libraries from libraries.txt if present
  const libraries: string[] = [];
  const libFile = Object.keys(zip.files).find(
    (name) => name === 'libraries.txt' || name.endsWith('/libraries.txt'),
  );
  if (libFile) {
    const libText = await zip.file(libFile)!.async('text');
    for (const line of libText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // "LibName@wokwi:hash" or "LibName@1.2.3" or "LibName"
        const name = trimmed.split('@')[0].split(':')[0];
        if (name) libraries.push(name);
      }
    }
  }

  // Detect board type from parts
  let boardType = 'arduino-uno';
  for (const part of parts) {
    const mapped = FRITZING_TO_CIRCUITMUSE[part.moduleIdRef];
    if (mapped && mapped.startsWith('arduino-') || mapped?.startsWith('raspberry-')) {
      boardType = mapped;
      break;
    }
  }

  return { boardType, parts, wires, code, libraries };
}

// ─── Load into Stores ─────────────────────────────────────────────────────

export function loadFritzingIntoStores(result: FritzingImportResult): void {
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();

  // Add the board
  const boardId = sim.addBoard(result.boardType, 200, 200);

  // Set code
  const group = editor.fileGroups[`group-${boardId}`];
  if (group && group.length > 0) {
    editor.setFileContent(group[0].id, result.code);
  }

  // Add components (skip the board itself)
  for (const part of result.parts) {
    const metadataId = FRITZING_TO_CIRCUITMUSE[part.moduleIdRef] ?? part.moduleIdRef;
    if (metadataId === result.boardType) continue; // Skip board duplicate

    const component = {
      id: `fritzing-${part.id}`,
      metadataId,
      left: part.x,
      top: part.y,
      rotate: part.rotation,
      attrs: {},
    };
    sim.recordAddComponent(component);
  }

  // Add wires
  for (const wire of result.wires) {
    const wireObj = {
      id: `fritzing-wire-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      start: {
        componentId: `fritzing-${wire.fromPart}`,
        pinId: wire.fromPin,
      },
      end: {
        componentId: `fritzing-${wire.toPart}`,
        pinId: wire.toPin,
      },
      color: wire.color,
    };
    sim.recordAddWire(wireObj);
  }
}
