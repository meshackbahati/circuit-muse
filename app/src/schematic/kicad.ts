/**
 * KiCad exporters: `.kicad_sch` schematic (KiCad 8 format, opens in KiCad
 * 8 and 9) and `.net` netlist (KiCad "E" S-expression netlist).
 *
 * Both are generated from `buildSchematicNetlist` (+ `layoutSchematic` for
 * the sheet), the same data the in-app schematic view draws, so the files
 * always match the canvas.
 *
 * Every symbol used is embedded in `lib_symbols` (KiCad needs that to open
 * a schematic without the libraries). Primitive parts use standard KiCad lib
 * ids (Device:R, Device:LED, Switch:SW_Push, power:GND, ...); boards and
 * modules get a generated box symbol under the "CircuitMuse:" library.
 * Connectivity is carried by global labels and power symbols on short wire
 * stubs; unconnected pins get no-connect flags.
 *
 * UUIDs are derived from the content, so exporting the same circuit twice
 * gives identical files (clean diffs in git).
 */
import { buildSchematicNetlist, type SchematicInput, type SchematicNetlist, type SchPart } from './netlist';
import { layoutSchematic, type SchematicLayout } from './layout';
import { powerSymbol, pwrFlagSymbol, type FieldPos, type PowerNet, type SymShape, type SymbolDef } from './symbols';

export interface KicadExportOptions {
  /** Project / file base name (used in the title block and instance paths). */
  projectName?: string;
  /** ISO date for the netlist header; defaults to now. */
  date?: string;
}

// ── S-expression helpers ──────────────────────────────────────────────────

/** Quote and escape a string for KiCad S-expressions. */
export function q(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** Compact decimal: max 4 places, no trailing zeros, never "-0". */
export function num(v: number): string {
  const r = Math.round(v * 10000) / 10000;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r);
}

/** Deterministic RFC-4122-shaped UUID from a seed string. */
export function uuidFrom(seed: string): string {
  const h = (salt: number) => {
    let x = 0x811c9dc5 ^ salt;
    for (let i = 0; i < seed.length; i++) {
      x ^= seed.charCodeAt(i);
      x = Math.imul(x, 0x01000193);
    }
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const hex = h(1) + h(2) + h(3) + h(4);
  const v = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v;
}

function font(): string {
  return '(font (size 1.27 1.27))';
}

function effects(opts: { justify?: string; hide?: boolean } = {}): string {
  return `(effects ${font()}${opts.justify ? ` (justify ${opts.justify})` : ''}${opts.hide ? ' hide' : ''})`;
}

function stroke(width = 0): string {
  return `(stroke (width ${num(width)}) (type default))`;
}

function fill(f: SymShape['fill']): string {
  return `(fill (type ${f ?? 'none'}))`;
}

function shapeSexpr(s: SymShape): string {
  if (s.kind === 'rect') {
    return `(rectangle (start ${num(s.x1)} ${num(s.y1)}) (end ${num(s.x2)} ${num(s.y2)}) ${stroke(s.width)} ${fill(s.fill)})`;
  }
  if (s.kind === 'poly') {
    return `(polyline (pts ${s.pts.map(([x, y]) => `(xy ${num(x)} ${num(y)})`).join(' ')}) ${stroke(s.width)} ${fill(s.fill)})`;
  }
  return `(circle (center ${num(s.cx)} ${num(s.cy)}) (radius ${num(s.r)}) ${stroke(s.width)} ${fill(s.fill)})`;
}

function splitLibId(libId: string): { lib: string; name: string } {
  const i = libId.indexOf(':');
  return i < 0 ? { lib: '', name: libId } : { lib: libId.slice(0, i), name: libId.slice(i + 1) };
}

function libFieldPos(f: FieldPos): string {
  return `(at ${num(f.x)} ${num(f.y)} ${f.angle})`;
}

/** One `lib_symbols` entry. */
export function libSymbolSexpr(sym: SymbolDef, footprint = ''): string {
  const { name } = splitLibId(sym.libId);
  const lines: string[] = [];
  lines.push(`    (symbol ${q(sym.libId)}${sym.power ? ' (power)' : ''}`);
  if (!sym.showPinNumbers) lines.push('      (pin_numbers hide)');
  lines.push(`      (pin_names (offset ${num(sym.pinNameOffset)})${sym.showPinNames ? '' : ' hide'})`);
  lines.push('      (exclude_from_sim no) (in_bom yes) (on_board yes)');
  lines.push(`      (property "Reference" ${q(sym.refPrefix)} ${libFieldPos(sym.refField)} ${effects({ justify: sym.refField.justify, hide: sym.refField.hide })})`);
  lines.push(`      (property "Value" ${q(name)} ${libFieldPos(sym.valueField)} ${effects({ justify: sym.valueField.justify, hide: sym.valueField.hide })})`);
  lines.push(`      (property "Footprint" ${q(footprint)} (at 0 0 0) ${effects({ hide: true })})`);
  lines.push(`      (property "Datasheet" "~" (at 0 0 0) ${effects({ hide: true })})`);
  lines.push(`      (property "Description" ${q(sym.description)} (at 0 0 0) ${effects({ hide: true })})`);
  lines.push(`      (symbol ${q(`${name}_0_1`)}`);
  for (const s of sym.shapes) lines.push(`        ${shapeSexpr(s)}`);
  lines.push('      )');
  lines.push(`      (symbol ${q(`${name}_1_1`)}`);
  for (const p of sym.pins) {
    const hidden = sym.power ? ' hide' : '';
    lines.push(
      `        (pin ${p.type} line (at ${num(p.x)} ${num(p.y)} ${p.angle}) (length ${num(p.length)})${hidden} (name ${q(p.name)} ${effects()}) (number ${q(p.number)} ${effects()}))`,
    );
  }
  lines.push('      )');
  lines.push('    )');
  return lines.join('\n');
}

// ── Schematic ─────────────────────────────────────────────────────────────

function rotateField(f: FieldPos, rotation: number): FieldPos {
  if (rotation === 0) return f;
  const a = (rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const si = Math.round(Math.sin(a));
  return { ...f, x: f.x * c - f.y * si, y: f.x * si + f.y * c, justify: undefined };
}

function fieldAt(x: number, y: number, f: FieldPos): string {
  return `(at ${num(x + f.x)} ${num(y - f.y)} ${f.angle})`;
}

function instanceSexpr(
  libId: string,
  x: number,
  y: number,
  rotation: number,
  ref: string,
  value: string,
  footprint: string,
  description: string,
  sym: SymbolDef,
  inBom: boolean,
  project: string,
  rootUuid: string,
  uuid: string,
  pinNumbers: string[],
): string {
  const L: string[] = [];
  L.push(`  (symbol (lib_id ${q(libId)}) (at ${num(x)} ${num(y)} ${rotation}) (unit 1)`);
  L.push(`    (exclude_from_sim no) (in_bom ${inBom ? 'yes' : 'no'}) (on_board yes) (dnp no)`);
  L.push(`    (uuid ${q(uuid)})`);
  // Field offsets rotate with the symbol (text itself stays horizontal).
  const rf = rotateField(sym.refField, rotation);
  const vf = rotateField(sym.valueField, rotation);
  L.push(`    (property "Reference" ${q(ref)} ${fieldAt(x, y, rf)} ${effects({ justify: rf.justify, hide: rf.hide })})`);
  L.push(`    (property "Value" ${q(value)} ${fieldAt(x, y, vf)} ${effects({ justify: vf.justify, hide: vf.hide })})`);
  L.push(`    (property "Footprint" ${q(footprint)} (at ${num(x)} ${num(y)} 0) ${effects({ hide: true })})`);
  L.push(`    (property "Datasheet" "~" (at ${num(x)} ${num(y)} 0) ${effects({ hide: true })})`);
  L.push(`    (property "Description" ${q(description)} (at ${num(x)} ${num(y)} 0) ${effects({ hide: true })})`);
  for (const n of pinNumbers) L.push(`    (pin ${q(n)} (uuid ${q(uuidFrom(`${uuid}/pin/${n}`))}))`);
  L.push(`    (instances (project ${q(project)} (path ${q(`/${rootUuid}`)} (reference ${q(ref)}) (unit 1))))`);
  L.push('  )');
  return L.join('\n');
}

export function generateKicadSchematic(
  netlist: SchematicNetlist,
  layout: SchematicLayout = layoutSchematic(netlist),
  opts: KicadExportOptions = {},
): string {
  const project = opts.projectName || 'circuitmuse';
  const rootUuid = uuidFrom(`root:${project}`);
  const out: string[] = [];
  out.push('(kicad_sch (version 20231120) (generator "circuitmuse") (generator_version "1.0")');
  out.push(`  (uuid ${q(rootUuid)})`);
  out.push(`  (paper ${q(layout.paper.name)})`);
  out.push(`  (title_block (title ${q(project)}) (comment 1 "Exported from CircuitMuse"))`);

  // lib_symbols: one per lib id used.
  out.push('  (lib_symbols');
  const emitted = new Set<string>();
  for (const part of netlist.parts) {
    if (emitted.has(part.libId)) continue;
    emitted.add(part.libId);
    out.push(libSymbolSexpr(part.symbol));
  }
  const powerNets = new Set<PowerNet>(layout.powers.map((p) => p.net));
  for (const pn of ['GND', '+5V', '+3V3'] as PowerNet[]) {
    if (powerNets.has(pn)) out.push(libSymbolSexpr(powerSymbol(pn)));
  }
  if (powerNets.size > 0) out.push(libSymbolSexpr(pwrFlagSymbol()));
  out.push('  )');

  // Wire stubs.
  for (const s of layout.stubs) {
    out.push(
      `  (wire (pts (xy ${num(s.x1)} ${num(s.y1)}) (xy ${num(s.x2)} ${num(s.y2)})) ${stroke(0)} (uuid ${q(uuidFrom(`wire:${s.x1},${s.y1},${s.x2},${s.y2}`))}))`,
    );
  }
  // No-connect flags.
  for (const n of layout.noConnects) {
    out.push(`  (no_connect (at ${num(n.x)} ${num(n.y)}) (uuid ${q(uuidFrom(`nc:${n.x},${n.y}`))}))`);
  }
  // Global labels.
  for (const l of layout.labels) {
    const id = uuidFrom(`label:${l.net}:${l.x},${l.y}`);
    out.push(
      `  (global_label ${q(l.net)} (shape passive) (at ${num(l.x)} ${num(l.y)} ${l.angle}) (fields_autoplaced yes) ${effects({ justify: l.justify })} (uuid ${q(id)})` +
        ` (property "Intersheetrefs" "\${INTERSHEET_REFS}" (at ${num(l.x)} ${num(l.y)} 0) ${effects({ justify: l.justify, hide: true })}))`,
    );
  }
  // Part symbols.
  for (const pp of layout.parts) {
    const part = pp.part;
    out.push(
      instanceSexpr(
        part.libId,
        pp.x,
        pp.y,
        0,
        part.ref,
        part.value,
        part.footprint,
        part.description,
        part.symbol,
        part.inBom,
        project,
        rootUuid,
        partUuid(part),
        part.symbol.pins.map((p) => p.number),
      ),
    );
  }
  // One PWR_FLAG per power net, on the pin of that net's first power
  // symbol (coincident pins connect), so KiCad's ERC treats the rail as
  // driven instead of reporting "power pin not driven".
  const flagged = new Set<PowerNet>();
  const flag = pwrFlagSymbol();
  layout.powers.forEach((p) => {
    if (flagged.has(p.net)) return;
    flagged.add(p.net);
    const ref = `#FLG${String(flagged.size).padStart(2, '0')}`;
    out.push(
      instanceSexpr(
        flag.libId,
        p.x,
        p.y,
        0,
        ref,
        'PWR_FLAG',
        '',
        flag.description,
        flag,
        true,
        project,
        rootUuid,
        uuidFrom(`flg:${p.net}`),
        ['1'],
      ),
    );
  });
  // Power symbols.
  layout.powers.forEach((p, i) => {
    const ref = `#PWR${String(i + 1).padStart(2, '0')}`;
    const sym = powerSymbol(p.net);
    out.push(
      instanceSexpr(
        sym.libId,
        p.x,
        p.y,
        p.rotation,
        ref,
        p.net,
        '',
        sym.description,
        sym,
        true,
        project,
        rootUuid,
        uuidFrom(`pwr:${p.net}:${p.x},${p.y}`),
        ['1'],
      ),
    );
  });
  out.push('  (sheet_instances (path "/" (page "1")))');
  out.push(')');
  return out.join('\n') + '\n';
}

function partUuid(part: SchPart): string {
  return uuidFrom(`part:${part.ref}:${part.sourceId}`);
}

// ── Netlist (.net) ────────────────────────────────────────────────────────

export function generateKicadNetlist(netlist: SchematicNetlist, opts: KicadExportOptions = {}): string {
  const project = opts.projectName || 'circuitmuse';
  const date = opts.date ?? new Date().toISOString();
  const L: string[] = [];
  L.push('(export (version "E")');
  L.push('  (design');
  L.push(`    (source ${q(`${project}.kicad_sch`)})`);
  L.push(`    (date ${q(date)})`);
  L.push('    (tool "CircuitMuse")');
  L.push('    (sheet (number "1") (name "/") (tstamps "/")');
  L.push(`      (title_block (title ${q(project)}) (company) (rev) (date) (source ${q(`${project}.kicad_sch`)}))))`);

  L.push('  (components');
  for (const part of netlist.parts) {
    const { lib, name } = splitLibId(part.libId);
    L.push(`    (comp (ref ${q(part.ref)})`);
    L.push(`      (value ${q(part.value)})`);
    if (part.footprint) L.push(`      (footprint ${q(part.footprint)})`);
    L.push(`      (description ${q(part.description)})`);
    L.push('      (fields');
    L.push(`        (field (name "Footprint") ${q(part.footprint)})`);
    L.push('        (field (name "Datasheet") "~")');
    L.push(`        (field (name "Description") ${q(part.description)})`);
    if (part.kicadSymbol && part.kicadSymbol !== part.libId) {
      L.push(`        (field (name "KiCad_Library_Symbol") ${q(part.kicadSymbol)})`);
    }
    if (part.footprintHint) L.push(`        (field (name "Suggested_Footprint") ${q(part.footprintHint)})`);
    L.push(`        (field (name "CircuitMuse_Id") ${q(part.sourceId)}))`);
    L.push(`      (libsource (lib ${q(lib)}) (part ${q(name)}) (description ${q(part.description)}))`);
    L.push('      (property (name "Sheetname") (value "Root"))');
    L.push(`      (property (name "Sheetfile") (value ${q(`${project}.kicad_sch`)}))`);
    if (!part.inBom) L.push('      (property (name "exclude_from_bom") (value ""))');
    L.push('      (sheetpath (names "/") (tstamps "/"))');
    L.push(`      (tstamps ${q(partUuid(part))}))`);
  }
  L.push('  )');

  L.push('  (libparts');
  const done = new Set<string>();
  for (const part of netlist.parts) {
    if (done.has(part.libId)) continue;
    done.add(part.libId);
    const { lib, name } = splitLibId(part.libId);
    const sym = part.symbol;
    L.push(`    (libpart (lib ${q(lib)}) (part ${q(name)})`);
    L.push(`      (description ${q(sym.description)})`);
    L.push('      (docs "~")');
    L.push(`      (fields (field (name "Reference") ${q(sym.refPrefix)}) (field (name "Value") ${q(name)}))`);
    L.push('      (pins');
    for (const p of sym.pins) {
      L.push(`        (pin (num ${q(p.number)}) (name ${q(p.name)}) (type ${q(p.type)}))`);
    }
    L.push('      ))');
  }
  L.push('  )');

  L.push('  (libraries)');

  L.push('  (nets');
  for (const net of netlist.nets) {
    L.push(`    (net (code ${q(String(net.code))}) (name ${q(net.name)})`);
    for (const n of net.nodes) {
      const fn = n.pinName && n.pinName !== '~' ? ` (pinfunction ${q(n.pinName)})` : '';
      L.push(`      (node (ref ${q(n.ref)}) (pin ${q(n.pin)})${fn} (pintype ${q(n.pinType)}))`);
    }
    L.push('    )');
  }
  L.push('  )');
  L.push(')');
  return L.join('\n') + '\n';
}

/** Minimal KiCad project file so the zip opens as a project. */
export function generateKicadProject(projectName: string): string {
  return (
    JSON.stringify(
      {
        meta: { filename: `${projectName}.kicad_pro`, version: 1 },
        sheets: [[uuidFrom(`root:${projectName}`), 'Root']],
      },
      null,
      2,
    ) + '\n'
  );
}

// ── Convenience: from circuit input ───────────────────────────────────────

export interface KicadBundle {
  schematic: string;
  netlist: string;
  project: string;
  data: SchematicNetlist;
}

export function exportKicad(input: SchematicInput, opts: KicadExportOptions = {}): KicadBundle {
  const projectName = kicadSafeName(opts.projectName || 'circuitmuse');
  const data = buildSchematicNetlist(input);
  const layout = layoutSchematic(data);
  return {
    schematic: generateKicadSchematic(data, layout, { ...opts, projectName }),
    netlist: generateKicadNetlist(data, { ...opts, projectName }),
    project: generateKicadProject(projectName),
    data,
  };
}

export function kicadSafeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || 'circuitmuse';
}
