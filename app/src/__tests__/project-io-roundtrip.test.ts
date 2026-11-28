// @vitest-environment jsdom
/**
 * Project export → import round-trips for every format the app offers:
 * .vlx, .json, Wokwi .zip and Fritzing .fzz import, plus the HTML report.
 *
 * Fixtures are real gallery examples loaded through `loadExample` (multi-board,
 * ESP32, Pico, MicroPython, analog board-less, programmable custom chip), then
 * decorated with the things a user adds by hand: wire waypoints, rotated parts,
 * nested properties, board names/options/libraries, chat history.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { useAgentStore } from '../store/useAgentStore';
import { useUploadsStore } from '../store/useUploadsStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { loadExample } from '../utils/loadExample';
import { exampleProjects } from '../data/examples';
import {
  exportAsVlx,
  exportAsJson,
  exportAsWokwiZip,
  exportAsHtmlReport,
  safeFilename,
} from '../utils/exportFormats';
import { importProjectFile } from '../utils/importProject';
import { importFromWokwiZip, buildWokwiDiagram, EMBEDDED_PROJECT_FILE } from '../utils/wokwiZip';
import { importFritzingFile } from '../utils/fritzingImport';
import { buildVlxPayload } from '../utils/vlxFile';
import type { Message } from '../agent/types';

// ─── helpers ────────────────────────────────────────────────────────────────

function resetWorkspace() {
  const sim = useSimulatorStore.getState();
  for (const id of sim.boards.map((b) => b.id)) sim.removeBoard(id);
  sim.setComponents([]);
  sim.setWires([]);
  useAgentStore.getState().setMessages([]);
  useUploadsStore.getState().setFiles([]);
  useWorkspaceStore.getState().setProject('ws-original', 'Original');
}

function example(id: string) {
  const e = exampleProjects.find((x) => x.id === id);
  if (!e) throw new Error(`missing example ${id}`);
  return e;
}

const CHAT: Message[] = [
  { id: 'm1', role: 'user', content: 'Make the LED blink faster', timestamp: 1 },
  { id: 'm2', role: 'assistant', content: 'Changed delay(1000) → delay(200).', timestamp: 2 },
];

/** Add what users do by hand on top of a gallery example. */
function decorate() {
  const sim = useSimulatorStore.getState();
  const wires = sim.wires.map((w, i) =>
    i % 2 === 0 ? { ...w, waypoints: [{ x: 10 + i, y: 20 + i }, { x: 30.5, y: 40.25 }] } : w,
  );
  sim.setWires(wires);
  const comps = sim.components.map((c, i) =>
    i === 0
      ? {
          ...c,
          properties: {
            ...c.properties,
            rotation: 90,
            count: 3,
            enabled: true,
            nested: { a: [1, 2], b: 'x' },
            label: 'Ünïcødé <b>&</b>',
          },
        }
      : c,
  );
  sim.setComponents(comps);
  const first = sim.boards[0];
  if (first) {
    sim.updateBoard(first.id, {
      name: 'Main board ✓',
      serialBaudRate: 115200,
      libraries: ['Servo', 'Adafruit GFX Library'],
    });
  }
  useAgentStore.getState().setMessages(CHAT);
}

/** Comparable view of everything a project file must preserve. */
function snapshot() {
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();
  const groupIds = new Set(sim.boards.map((b) => b.activeFileGroupId));
  for (const gid of Object.keys(editor.fileGroups)) if (gid.startsWith('group-chip-')) groupIds.add(gid);
  const fileGroups: Record<string, Array<{ name: string; content: string }>> = {};
  for (const gid of [...groupIds].sort()) {
    fileGroups[gid] = (editor.fileGroups[gid] ?? []).map((f) => ({ name: f.name, content: f.content }));
  }
  return {
    boards: sim.boards.map((b) => ({
      id: b.id,
      boardKind: b.boardKind,
      x: b.x,
      y: b.y,
      name: b.name,
      languageMode: b.languageMode,
      serialBaudRate: b.serialBaudRate,
      libraries: b.libraries,
      boardOptions: b.boardOptions,
      activeFileGroupId: b.activeFileGroupId,
    })),
    components: sim.components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      x: c.x,
      y: c.y,
      properties: c.properties,
    })),
    wires: sim.wires.map((w) => ({
      id: w.id,
      start: { componentId: w.start.componentId, pinName: w.start.pinName },
      end: { componentId: w.end.componentId, pinName: w.end.pinName },
      waypoints: w.waypoints,
      color: w.color,
    })),
    fileGroups,
    activeBoardId: sim.activeBoardId,
  };
}

async function blobToFile(blob: Blob, name: string): Promise<File> {
  return new File([await blob.arrayBuffer()], name, { type: blob.type });
}

function textFile(text: string, name: string): File {
  const type = /\.(vlx|json)$/.test(name) ? 'application/json' : name.endsWith('.zip') ? 'application/zip' : 'text/plain';
  return new File([text], name, { type });
}

async function loadDifferentProject() {
  // Something clearly different so a no-op import can't pass the check.
  await loadExample(example('ky-040-rotary-encoder'));
  useAgentStore.getState().setMessages([{ id: 'other', role: 'user', content: 'other', timestamp: 9 }]);
}

const FIXTURES = [
  'ky-040-rotary-encoder', // Uno + parts with properties
  'stm32-esp32-gpio-sync', // multi-board STM32 + ESP32
  'esp32-blink-led', // ESP32
  'dual-pico-serial1-passthrough', // two Picos
  'picow-wifi-async-led', // MicroPython on Pico W
  'i8080-banner-streamer', // programmable custom chip with its own group
  'an-voltage-divider', // board-less analog circuit
];

// ─── .vlx / .json / .zip lossless round-trips ──────────────────────────────

describe.each([
  ['vlx', async () => blobToFile(exportAsVlx('My Project'), 'My Project.vlx')],
  ['json', async () => blobToFile(exportAsJson('My Project'), 'My Project.json')],
  ['zip', async () => blobToFile(await exportAsWokwiZip('My Project'), 'My Project.zip')],
] as const)('%s export → import round-trip', (_fmt, exportFile) => {
  beforeEach(resetWorkspace);

  it.each(FIXTURES)('keeps everything for %s', async (id) => {
    await loadExample(example(id));
    decorate();
    const before = snapshot();
    expect(before.components.length + before.boards.length).toBeGreaterThan(0);

    const file = await exportFile();
    await loadDifferentProject();
    const result = await importProjectFile(file);

    expect(snapshot()).toEqual(before);
    expect(useAgentStore.getState().messages).toEqual(CHAT);
    expect(result.warnings).toEqual([]);
    // Import opens as a new local project so auto-save can't overwrite the old one.
    expect(useWorkspaceStore.getState().projectId).not.toBe('ws-original');
  });
});

describe('.vlx specifics', () => {
  beforeEach(resetWorkspace);

  it('keeps ESP32 board options, SPIFFS files and uploads', async () => {
    await loadExample(example('esp32-blink-led'));
    const sim = useSimulatorStore.getState();
    const id = sim.boards[0].id;
    const boardOptions = { cpuFreqMHz: 160, partitionScheme: 'huge_app' } as never;
    const spiffsFiles = [{ name: 'index.html', content: '<h1>hi</h1>' }] as never;
    sim.updateBoard(id, { boardOptions, spiffsFiles });
    useUploadsStore.getState().setFiles([
      { id: 'u1', name: 'notes.txt', mime: 'text/plain', size: 5, kind: 'text', text: 'hello' },
    ]);
    const file = await blobToFile(exportAsVlx('esp'), 'esp.vlx');
    await loadDifferentProject();
    useUploadsStore.getState().setFiles([]);
    await importProjectFile(file);
    const board = useSimulatorStore.getState().boards[0];
    expect(board.boardOptions).toEqual(boardOptions);
    expect(board.spiffsFiles).toEqual(spiffsFiles);
    expect(useUploadsStore.getState().files.map((f) => f.name)).toEqual(['notes.txt']);
  });

  it('names the imported project after the file (unicode and spaces kept)', async () => {
    await loadExample(example('esp32-blink-led'));
    const payload = buildVlxPayload();
    delete payload.name;
    await importProjectFile(textFile(JSON.stringify(payload), 'Mradi wangu été ✓.vlx'));
    expect(useWorkspaceStore.getState().projectName).toBe('Mradi wangu été ✓');
  });

  it('safeFilename keeps non-ASCII letters and drops unsafe characters', () => {
    expect(safeFilename('Projet été 中文', 'vlx')).toBe('Projet-été-中文.vlx');
    expect(safeFilename('../../etc/passwd', 'zip')).toBe('etc-passwd.zip');
    expect(safeFilename('   ', 'json')).toBe('circuit-muse-project.json');
  });

  it('handles a large project (1,500 parts, 1,500 wires with waypoints)', async () => {
    await loadExample(example('ky-040-rotary-encoder'));
    const sim = useSimulatorStore.getState();
    const comps = Array.from({ length: 1500 }, (_, i) => ({
      id: `r${i}`,
      metadataId: 'resistor',
      x: i * 3,
      y: i * 2,
      properties: { resistance: String(i) },
    }));
    sim.setComponents(comps);
    sim.setWires(
      comps.map((c, i) => ({
        id: `w${i}`,
        start: { componentId: c.id, pinName: '1', x: 0, y: 0 },
        end: { componentId: 'arduino-uno', pinName: 'GND', x: 0, y: 0 },
        waypoints: [{ x: i, y: i + 1 }],
        color: '#000000',
      })),
    );
    const before = snapshot();
    for (const [blob, name] of [
      [exportAsVlx('big'), 'big.vlx'],
      [await exportAsWokwiZip('big'), 'big.zip'],
    ] as const) {
      const file = await blobToFile(blob, name);
      await loadDifferentProject();
      await importProjectFile(file);
      expect(snapshot()).toEqual(before);
    }
  });
});

// ─── backward compatibility ────────────────────────────────────────────────

describe('older files still open', () => {
  beforeEach(resetWorkspace);

  it('reads a "velxio-project" v1 file from the earlier brand', async () => {
    const legacy = {
      format: 'velxio-project',
      version: 1,
      exportedAt: '2025-01-01T00:00:00Z',
      boards: [{ id: 'arduino-uno', boardKind: 'arduino-uno', x: 50, y: 60, activeFileGroupId: 'group-arduino-uno', languageMode: 'arduino' }],
      fileGroups: { 'group-arduino-uno': [{ name: 'sketch.ino', content: 'void setup(){}\nvoid loop(){}' }] },
      components: [{ id: 'led1', metadataId: 'led', x: 300, y: 100, properties: { color: 'red' } }],
      wires: [{ id: 'w1', start: { componentId: 'led1', pinName: 'A', x: 0, y: 0 }, end: { componentId: 'arduino-uno', pinName: '13', x: 0, y: 0 }, waypoints: [], color: '#ff0000' }],
      activeBoardId: 'arduino-uno',
    };
    await importProjectFile(textFile(JSON.stringify(legacy), 'old.vlx'));
    const s = snapshot();
    expect(s.boards[0]).toMatchObject({ id: 'arduino-uno', x: 50, y: 60 });
    expect(s.components[0]).toMatchObject({ id: 'led1', properties: { color: 'red' } });
    expect(s.fileGroups['group-arduino-uno'][0].content).toContain('void loop');
  });

  it('reads the old raw .json export (live board state, no format field, pinId wires)', async () => {
    const old = {
      boards: [
        {
          id: 'arduino-uno', boardKind: 'arduino-uno', x: 10, y: 20, running: true,
          compiledProgram: ':00000001FF', serialOutput: 'hello', serialBaudRate: 9600,
          serialMonitorOpen: true, activeFileGroupId: 'group-arduino-uno', languageMode: 'arduino',
        },
      ],
      components: [{ id: 'btn', metadataId: 'pushbutton', left: 120, top: 80, attrs: { color: 'blue' }, rotate: 180 }],
      wires: [{ id: 'w', start: { componentId: 'btn', pinId: '1.l' }, end: { componentId: 'arduino-uno', pinId: '2' }, color: 'green' }],
      fileGroups: { 'group-arduino-uno': [{ id: 'x', name: 'sketch.ino', content: '// old', modified: true }] },
      activeBoardId: 'arduino-uno',
      exportedAt: '2025-06-01T00:00:00Z',
    };
    await importProjectFile(textFile(JSON.stringify(old), 'old.json'));
    const s = snapshot();
    expect(s.boards[0]).toMatchObject({ id: 'arduino-uno', x: 10, y: 20, serialBaudRate: 9600 });
    expect(useSimulatorStore.getState().boards[0].running).toBe(false);
    expect(s.components[0]).toEqual({ id: 'btn', metadataId: 'pushbutton', x: 120, y: 80, properties: { color: 'blue', rotation: 180 } });
    expect(s.wires[0].start.pinName).toBe('1.l');
    expect(s.wires[0].waypoints).toEqual([]);
    expect(s.fileGroups['group-arduino-uno']).toEqual([{ name: 'sketch.ino', content: '// old' }]);
  });

  it('remaps files saved under a non-standard group id onto the board', async () => {
    const payload = {
      format: 'circuit-muse-project',
      version: 1,
      boards: [{ id: 'esp32', boardKind: 'esp32', x: 0, y: 0, activeFileGroupId: 'my-group' }],
      fileGroups: { 'my-group': [{ name: 'sketch.ino', content: '// esp' }] },
      components: [],
      wires: [],
      activeBoardId: 'esp32',
    };
    await importProjectFile(textFile(JSON.stringify(payload), 'p.vlx'));
    expect(snapshot().fileGroups['group-esp32']).toEqual([{ name: 'sketch.ino', content: '// esp' }]);
  });

  it('a file without chat history leaves the chat panel alone', async () => {
    await loadExample(example('esp32-blink-led'));
    const payload = buildVlxPayload({ includeChat: false });
    useAgentStore.getState().setMessages(CHAT);
    await importProjectFile(textFile(JSON.stringify(payload), 'p.vlx'));
    expect(useAgentStore.getState().messages).toEqual(CHAT);
  });
});

// ─── bad files are rejected without touching the workspace ─────────────────

describe('bad files fail clearly and leave the project untouched', () => {
  beforeEach(resetWorkspace);

  const notZip = 'definitely not a zip';
  const cases: Array<[string, () => Promise<File> | File, RegExp]> = [
    ['corrupt .vlx JSON', () => textFile('{"format": "circuit-muse-project", ', 'a.vlx'), /Invalid JSON/],
    ['empty .vlx', () => textFile('', 'a.vlx'), /empty/],
    ['wrong format field', () => textFile(JSON.stringify({ format: 'something-else', version: 1 }), 'a.vlx'), /Not a CircuitMuse project/],
    ['newer version', () => textFile(JSON.stringify({ format: 'circuit-muse-project', version: 99, boards: [], fileGroups: {}, components: [], wires: [] }), 'a.vlx'), /version 99/],
    ['unknown board kind', () => textFile(JSON.stringify({ format: 'circuit-muse-project', version: 1, boards: [{ id: 'q', boardKind: 'quantum-board', x: 0, y: 0 }], fileGroups: {}, components: [], wires: [] }), 'a.vlx'), /quantum-board/],
    ['component without id', () => textFile(JSON.stringify({ format: 'circuit-muse-project', version: 1, boards: [], fileGroups: {}, components: [{ metadataId: 'led' }], wires: [] }), 'a.vlx'), /Component #1/],
    ['wire without endpoints', () => textFile(JSON.stringify({ format: 'circuit-muse-project', version: 1, boards: [], fileGroups: {}, components: [], wires: [{ id: 'w' }] }), 'a.vlx'), /Wire #1/],
    ['random JSON', () => textFile('[1,2,3]', 'a.json'), /not a JSON object/],
    ['not a zip', () => textFile(notZip, 'a.zip'), /not a valid \.zip/],
    ['zip without diagram.json', async () => {
      const z = new JSZip();
      z.file('sketch.ino', 'void setup(){}');
      return blobToFile(await z.generateAsync({ type: 'blob' }), 'a.zip');
    }, /No diagram\.json/],
    ['zip with broken diagram.json', async () => {
      const z = new JSZip();
      z.file('diagram.json', '{ parts: [');
      return blobToFile(await z.generateAsync({ type: 'blob' }), 'a.zip');
    }, /diagram\.json is not valid JSON/],
    ['not a .fzz', () => textFile(notZip, 'a.fzz'), /not a valid Fritzing/],
    ['.fzz without sketch', async () => {
      const z = new JSZip();
      z.file('readme.txt', 'hi');
      return blobToFile(await z.generateAsync({ type: 'blob' }), 'a.fzz');
    }, /No Fritzing sketch/],
    ['.fzz with broken XML', async () => {
      const z = new JSZip();
      z.file('a.fz', '<module><instances><instance');
      return blobToFile(await z.generateAsync({ type: 'blob' }), 'a.fzz');
    }, /not valid XML/],
    ['unsupported extension', () => textFile('hello', 'a.txt'), /Unsupported file/],
  ];

  it.each(cases)('%s', async (_label, makeFile, message) => {
    await loadExample(example('stm32-esp32-gpio-sync'));
    decorate();
    const before = snapshot();
    const file = await makeFile();
    await expect(importProjectFile(file)).rejects.toThrow(message);
    expect(snapshot()).toEqual(before);
    expect(useAgentStore.getState().messages).toEqual(CHAT);
    expect(useWorkspaceStore.getState().projectId).toBe('ws-original');
  });
});

describe('a failure half-way through loading restores the previous project', () => {
  beforeEach(resetWorkspace);

  it('rolls back when the store throws after tearing the old boards down', async () => {
    await loadExample(example('stm32-esp32-gpio-sync'));
    decorate();
    const before = snapshot();
    const payload = buildVlxPayload();

    const store = useSimulatorStore.getState();
    const original = store.loadProjectState;
    let calls = 0;
    useSimulatorStore.setState({
      loadProjectState: (p) => {
        calls++;
        if (calls === 1) {
          // Simulate a crash after the destructive part already ran.
          for (const id of useSimulatorStore.getState().boards.map((b) => b.id)) store.removeBoard(id);
          throw new Error('boom');
        }
        original(p);
      },
    });
    try {
      await expect(
        importProjectFile(textFile(JSON.stringify({ ...payload, name: 'x' }), 'x.vlx')),
      ).rejects.toThrow(/boom/);
    } finally {
      useSimulatorStore.setState({ loadProjectState: original });
    }
    expect(calls).toBe(2);
    expect(snapshot()).toEqual(before);
    expect(useWorkspaceStore.getState().projectId).toBe('ws-original');
  });
});

// ─── Wokwi interoperability (diagram.json only) ────────────────────────────

describe('Wokwi .zip interoperability', () => {
  beforeEach(resetWorkspace);

  it('writes a diagram.json Wokwi can read (positions, pins, board ids, rotation)', async () => {
    await loadExample(example('ky-040-rotary-encoder'));
    decorate();
    const payload = buildVlxPayload();
    const diagram = buildWokwiDiagram(payload);
    expect(diagram.parts[0]).toMatchObject({ type: 'wokwi-arduino-uno', id: 'uno' });
    for (const p of diagram.parts) {
      expect(Number.isFinite(p.top)).toBe(true);
      expect(Number.isFinite(p.left)).toBe(true);
      for (const v of Object.values(p.attrs)) expect(typeof v).toBe('string');
    }
    const rotated = diagram.parts.find((p) => p.id === payload.components[0].id)!;
    expect(rotated.rotate).toBe(90);
    expect(rotated.attrs.rotation).toBeUndefined();
    expect(diagram.connections.length).toBe(payload.wires.length);
    for (const c of diagram.connections) {
      expect(c[0]).toMatch(/^[^:]+:.+$/);
      expect(c[1]).toMatch(/^[^:]+:.+$/);
      expect(c[0]).not.toContain('undefined');
    }
    expect(diagram.connections.some((c) => c[1].startsWith('uno:') || c[0].startsWith('uno:'))).toBe(true);

    const zip = await JSZip.loadAsync(await exportAsWokwiZip('enc'));
    expect(zip.file('sketch.ino')).toBeTruthy();
    expect(zip.file('libraries.txt')).toBeTruthy();
    expect(zip.file(EMBEDDED_PROJECT_FILE)).toBeTruthy();
  });

  it('imports a plain Wokwi project (no CircuitMuse snapshot)', async () => {
    const z = new JSZip();
    z.file(
      'diagram.json',
      JSON.stringify({
        version: 1,
        author: 'someone',
        editor: 'wokwi',
        parts: [
          { type: 'wokwi-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} },
          { type: 'wokwi-led', id: 'led1', top: -60, left: 120, rotate: 90, attrs: { color: 'red' } },
          { type: 'wokwi-resistor', id: 'esp32', top: 10, left: 20, attrs: { value: '220' } },
          { type: 'board-ssd1306', id: 'oled', top: 100, left: 200, attrs: {} },
        ],
        connections: [
          ['esp:D2', 'led1:A', 'green', ['v0']],
          ['led1:C', 'esp32:1', 'black', []],
          ['oled:SDA', 'esp:D21', 'blue', []],
          ['ghost:1', 'esp:GND.1', 'red', []],
          'garbage',
        ],
      }),
    );
    z.file('sketch.ino', 'void setup(){}\nvoid loop(){}');
    z.file('helpers.h', '#pragma once');
    z.file('libraries.txt', '# libs\nAdafruit SSD1306\nFoo@wokwi:abc\n');
    const file = await blobToFile(await z.generateAsync({ type: 'blob' }), 'wokwi project.zip');
    const result = await importProjectFile(file);

    expect(result.libraries).toEqual(['Adafruit SSD1306', 'Foo@wokwi:abc']);
    expect(result.warnings.join(' ')).toMatch(/2 connection/);
    const s = snapshot();
    expect(s.boards).toHaveLength(1);
    expect(s.boards[0]).toMatchObject({ id: 'esp32', boardKind: 'esp32', x: 50, y: 50 });
    // The resistor's id clashed with the board id and was renamed.
    const resistor = s.components.find((c) => c.metadataId === 'resistor')!;
    expect(resistor.id).not.toBe('esp32');
    const led = s.components.find((c) => c.id === 'led1')!;
    expect(led).toMatchObject({ x: 170, y: -10, properties: { color: 'red', rotation: 90 } });
    expect(s.wires).toHaveLength(3);
    expect(s.wires[0]).toMatchObject({ start: { componentId: 'esp32', pinName: 'D2' }, end: { componentId: 'led1', pinName: 'A' } });
    expect(s.wires[1].end).toEqual({ componentId: resistor.id, pinName: '1' });
    expect(s.wires[2].start.pinName).toBe('DATA'); // ssd1306 alias
    expect(s.fileGroups['group-esp32'].map((f) => f.name)).toEqual(['sketch.ino', 'helpers.h']);
    expect(s.activeBoardId).toBe('esp32');
  });

  it('reads Pico zips written by older CircuitMuse versions', async () => {
    const z = new JSZip();
    z.file('diagram.json', JSON.stringify({
      version: 1, author: 'CircuitMuse', editor: 'wokwi',
      parts: [{ type: 'wokwi-raspberry-pi-pico', id: 'pico', top: 0, left: 0, attrs: {} }],
      connections: [],
    }));
    z.file('sketch.ino', '// pico');
    const result = await importFromWokwiZip(await z.generateAsync({ type: 'blob' }));
    expect(result.payload.boards[0].boardKind).toBe('raspberry-pi-pico');
  });

  it('uses diagram.json instead of the snapshot once diagram.json was edited', async () => {
    await loadExample(example('ky-040-rotary-encoder'));
    const zip = await JSZip.loadAsync(await exportAsWokwiZip('enc'));
    const diagram = JSON.parse(await zip.file('diagram.json')!.async('string'));
    diagram.parts.push({ type: 'wokwi-led', id: 'added-in-wokwi', top: 5, left: 5, attrs: {} });
    zip.file('diagram.json', JSON.stringify(diagram));
    const result = await importFromWokwiZip(await zip.generateAsync({ type: 'blob' }));
    expect(result.source).toBe('wokwi');
    expect(result.payload.components.some((c) => c.id === 'added-in-wokwi')).toBe(true);
  });
});

// ─── Fritzing .fzz import ──────────────────────────────────────────────────

/** A small but realistic Fritzing 0.9.x sketch: Uno, resistor, LED, breadboard, wires. */
function fritzingSketch(): string {
  const conn = (cid: string, to: Array<[string, string]>) =>
    `<connector connectorId="${cid}" layer="breadboard"><geometry x="0" y="0"/><connects>${to
      .map(([idx, c]) => `<connect connectorId="${c}" modelIndex="${idx}" layer="breadboardbreadboard"/>`)
      .join('')}</connects></connector>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<module fritzingVersion="0.9.3b.04.19.5c895d327c44">
  <views><view name="breadboardView" backgroundColor="#ffffff"/></views>
  <instances>
    <instance moduleIdRef="arduino_Uno_Rev3(fix)" modelIndex="100" path=":/resources/parts/core/Arduino_Uno_Rev3(fix).fzp">
      <title>Arduino Uno (Rev3)</title>
      <views><breadboardView layer="breadboard"><geometry z="1" x="40" y="80"/>
        <connectors>${conn('connector61', [['400', 'connector1']])}</connectors>
      </breadboardView></views>
    </instance>
    <instance moduleIdRef="ResistorModuleID" modelIndex="200" path=":/resources/parts/core/resistor.fzp">
      <property name="resistance" value="220Ω"/>
      <title>R1</title>
      <views><breadboardView layer="breadboard">
        <geometry z="2" x="400" y="120"><transform m11="0" m12="1" m21="-1" m22="0" dx="0" dy="0"/></geometry>
        <connectors>${conn('connector0', [['401', 'connector0']])}${conn('connector1', [['400', 'connector0']])}</connectors>
      </breadboardView>
      <schematicView layer="schematic"><geometry x="1" y="1"/></schematicView></views>
    </instance>
    <instance moduleIdRef="5mmColorLEDModuleID" modelIndex="300" path=":/resources/parts/core/LED-generic-5mm.fzp">
      <property name="color" value="Red (633nm)"/>
      <title>LED1</title>
      <views><breadboardView layer="breadboard"><geometry z="3" x="600" y="100"/>
        <connectors>${conn('connector1', [['402', 'connector1']])}${conn('connector0', [['401', 'connector1']])}</connectors>
      </breadboardView></views>
    </instance>
    <instance moduleIdRef="Breadboard2ModuleID" modelIndex="50" path=":/resources/parts/core/breadboard2.fzp">
      <title>Breadboard1</title>
      <views><breadboardView layer="breadboardbreadboard"><geometry z="0" x="0" y="0"/></breadboardView></views>
    </instance>
    <instance moduleIdRef="SparkFun-Sensors-HIH-4030" modelIndex="500" path="user/hih.fzp">
      <title>Humidity</title>
      <views><breadboardView layer="breadboard"><geometry z="4" x="800" y="100"/></breadboardView></views>
    </instance>
    <instance moduleIdRef="WireModuleID" modelIndex="400" path=":/resources/parts/core/wire.fzp">
      <title>Wire1</title>
      <views><breadboardView layer="breadboardWire">
        <geometry z="5" x="100" y="100" x1="0" y1="0" x2="200" y2="0" wireFlags="64"/>
        <wireExtras mils="22.2" color="#cc1414" opacity="1" banded="0"/>
        <connectors>${conn('connector0', [['200', 'connector1']])}${conn('connector1', [['100', 'connector61']])}</connectors>
      </breadboardView></views>
    </instance>
    <instance moduleIdRef="WireModuleID" modelIndex="401" path=":/resources/parts/core/wire.fzp">
      <title>Wire2</title>
      <views><breadboardView layer="breadboardWire">
        <geometry z="5" x="400" y="200" x1="0" y1="0" x2="100" y2="40" wireFlags="64"/>
        <wireExtras mils="22.2" color="#418dd9" opacity="1" banded="0"/>
        <connectors>${conn('connector0', [['200', 'connector0']])}${conn('connector1', [['402', 'connector0']])}</connectors>
      </breadboardView></views>
    </instance>
    <instance moduleIdRef="WireModuleID" modelIndex="402" path=":/resources/parts/core/wire.fzp">
      <title>Wire3</title>
      <views><breadboardView layer="breadboardWire">
        <geometry z="5" x="500" y="240" x1="0" y1="0" x2="100" y2="-140" wireFlags="64"/>
        <wireExtras mils="22.2" color="#418dd9" opacity="1" banded="0"/>
        <connectors>${conn('connector0', [['401', 'connector1']])}${conn('connector1', [['300', 'connector0']])}</connectors>
      </breadboardView></views>
    </instance>
  </instances>
  <programs><program language="Arduino">Blink/Blink.ino</program></programs>
</module>`;
}

async function makeFzz(entries: Record<string, string>, name = 'blink circuit.fzz'): Promise<File> {
  const z = new JSZip();
  for (const [n, c] of Object.entries(entries)) z.file(n, c);
  return blobToFile(await z.generateAsync({ type: 'blob' }), name);
}

describe('Fritzing .fzz import', () => {
  beforeEach(resetWorkspace);

  it('imports parts, wire chains (with bends), properties and the program', async () => {
    const file = await makeFzz({
      'blink circuit.fz': fritzingSketch(),
      'Blink.ino': 'void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){}',
    });
    await loadDifferentProject();
    const result = await importProjectFile(file);
    const s = snapshot();

    expect(s.boards).toHaveLength(1);
    expect(s.boards[0]).toMatchObject({ id: 'arduino-uno', boardKind: 'arduino-uno', x: 30, y: 60 });
    expect(s.fileGroups['group-arduino-uno']).toEqual([
      { name: 'Blink.ino', content: 'void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){}' },
    ]);
    expect(s.components).toEqual([
      { id: 'R1', metadataId: 'resistor', x: 300, y: 90, properties: { resistance: '220', rotation: 90 } },
      { id: 'LED1', metadataId: 'led', x: 450, y: 75, properties: { color: 'red' } },
    ]);
    // Wire2 + Wire3 form one chain R1.1 → LED1 cathode with a bend between them.
    expect(s.wires).toHaveLength(1);
    expect(s.wires[0]).toMatchObject({
      start: { componentId: 'R1', pinName: '1' },
      end: { componentId: 'LED1', pinName: 'C' },
      waypoints: [{ x: 375, y: 180 }],
      color: '#418dd9',
    });
    // The resistor → Uno pin wire can't be matched (board pin names aren't in the file).
    expect(result.warnings.join('\n')).toMatch(/1 wire\(s\)/);
    expect(result.warnings.join('\n')).toMatch(/SparkFun-Sensors-HIH-4030/);
    expect(useWorkspaceStore.getState().projectName).toBe('blink circuit');
  });

  it('accepts the simplified <wire>/<code> layout', async () => {
    const xml = `<?xml version="1.0"?><module><instances>
      <instance moduleIdRef="wokwi-arduino-uno" id="uno"><views><breadboardView><svg transform="translate(100, 200)"/></breadboardView></views></instance>
      <instance moduleIdRef="wokwi-led" id="l1"><views><breadboardView><svg transform="translate(400, 200) rotate(180)"/></breadboardView></views></instance>
    </instances>
    <wires><wire fromPart="l1" fromConnectorId="A" toPart="uno" toConnectorId="13" color="#ff0000"/></wires>
    <programs><program><code>void setup(){}</code></program></programs></module>`;
    const result = await importFritzingFile(await makeFzz({ 'x.fz': xml }));
    expect(result.boardType).toBe('arduino-uno');
    await importProjectFile(await makeFzz({ 'x.fz': xml }));
    const s = snapshot();
    expect(s.components[0]).toMatchObject({ metadataId: 'led', x: 300, y: 150, properties: { rotation: 180 } });
    expect(s.wires[0]).toMatchObject({ start: { pinName: 'A' }, end: { componentId: 'arduino-uno', pinName: '13' } });
    expect(s.fileGroups['group-arduino-uno'][0].content).toBe('void setup(){}');
  });

  it('a second import replaces the first instead of duplicating ids', async () => {
    const entries = { 'a.fz': fritzingSketch(), 'Blink.ino': '//' };
    await importProjectFile(await makeFzz(entries));
    await importProjectFile(await makeFzz(entries));
    const ids = useSimulatorStore.getState().components.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(useSimulatorStore.getState().boards).toHaveLength(1);
  });
});

// ─── HTML report ───────────────────────────────────────────────────────────

describe('HTML report', () => {
  beforeEach(resetWorkspace);

  it('is self-contained and escapes every piece of user text', async () => {
    await loadExample(example('ky-040-rotary-encoder'));
    const sim = useSimulatorStore.getState();
    const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
    sim.setComponents([
      ...sim.components,
      { id: `c${evil}`, metadataId: `led${evil}`, x: 1, y: 2, properties: { label: evil } },
    ]);
    sim.setWires([
      ...sim.wires,
      { id: 'w-evil', start: { componentId: `c${evil}`, pinName: evil, x: 0, y: 0 }, end: { componentId: 'arduino-uno', pinName: '13', x: 0, y: 0 }, waypoints: [], color: evil },
    ]);
    sim.updateBoard(sim.boards[0].id, { name: evil });
    const ed = useEditorStore.getState();
    const gid = sim.boards[0].activeFileGroupId;
    ed.setFileContent(ed.fileGroups[gid][0].id, `// </code></pre>${evil}\nvoid loop() { if (a < b && c > d) {} }`);
    useAgentStore.getState().setMessages([{ id: 'x', role: 'user', content: 'SECRET CHAT', timestamp: 1 }]);

    const html = await exportAsHtmlReport(`Report ${evil}`).text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('SECRET CHAT');
    expect(html).not.toMatch(/<link|src="http/i);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script, img, iframe').length).toBe(0);
    expect(doc.title).toContain('<script>');
    expect(doc.body.textContent).toContain('void loop()');
    expect(doc.body.textContent).toContain('enc1');
    const rows = doc.querySelectorAll('table tr');
    expect(rows.length).toBeGreaterThan(3);
  });
});
