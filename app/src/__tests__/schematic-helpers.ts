/**
 * Test helpers for the schematic / KiCad tests: turn an ExampleProject into
 * the same boards/components/wires the store holds after `loadExample`, and
 * a tiny S-expression parser to read the generated KiCad files back.
 */
import type { ExampleProject } from '../data/examples';
import type { SchematicInput } from '../schematic/netlist';
import { isBoardComponent } from '../utils/boardPinMapping';
import { stripBrandPrefix } from '../utils/exampleToBuildNetlistInput';

/** Mirrors loadExample.ts: board ids, board-component filtering, id remap. */
export function exampleToSchematicInput(example: ExampleProject): SchematicInput {
  const boards: SchematicInput['boards'] = [];
  if (example.boards && example.boards.length > 0) {
    const count = new Map<string, number>();
    for (const eb of example.boards) {
      const n = (count.get(eb.boardKind) ?? 0) + 1;
      count.set(eb.boardKind, n);
      boards.push({ id: n === 1 ? eb.boardKind : `${eb.boardKind}-${n}`, boardKind: eb.boardKind, x: eb.x, y: eb.y });
    }
  } else {
    const filter = example.boardFilter;
    if (filter !== 'analog' && filter !== 'digital') {
      const kind = example.boardType || 'arduino-uno';
      boards.push({ id: kind, boardKind: kind, x: 50, y: 50 });
    }
  }
  const multi = !!example.boards?.length;
  const components = example.components
    .filter((c) => {
      const t = c.type;
      return !(t.includes('arduino') || t.includes('pico') || t.includes('esp32') || (multi && t.includes('raspberry')));
    })
    .map((c) => ({ id: c.id, metadataId: stripBrandPrefix(c.type), x: c.x, y: c.y, properties: c.properties ?? {} }));
  const active = boards[0]?.id;
  const remap = (id: string) => (!multi && isBoardComponent(id) && active ? active : id);
  const wires = example.wires.map((w) => ({
    id: w.id,
    start: { componentId: remap(w.start.componentId), pinName: w.start.pinName },
    end: { componentId: remap(w.end.componentId), pinName: w.end.pinName },
  }));
  return { boards, components, wires };
}

// ── S-expressions ─────────────────────────────────────────────────────────

export type SExpr = string | SExpr[];

/** Strict parser: throws on unbalanced parentheses or unterminated strings. */
export function parseSExpr(text: string): SExpr {
  let i = 0;
  const stack: SExpr[][] = [[]];
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(') {
      stack.push([]);
      i++;
    } else if (ch === ')') {
      if (stack.length < 2) throw new Error(`Unbalanced ')' at ${i}`);
      const done = stack.pop()!;
      stack[stack.length - 1].push(done);
      i++;
    } else if (ch === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          const n = text[i + 1];
          s += n === 'n' ? '\n' : n;
          i += 2;
        } else {
          s += text[i++];
        }
      }
      if (i >= text.length) throw new Error('Unterminated string');
      i++;
      stack[stack.length - 1].push(s);
    } else if (/\s/.test(ch)) {
      i++;
    } else {
      let s = '';
      while (i < text.length && !/[\s()"]/.test(text[i])) s += text[i++];
      stack[stack.length - 1].push(s);
    }
  }
  if (stack.length !== 1) throw new Error(`Unbalanced: ${stack.length - 1} unclosed '('`);
  if (stack[0].length !== 1) throw new Error(`Expected one top-level expression, got ${stack[0].length}`);
  return stack[0][0];
}

export function children(e: SExpr, head: string): SExpr[][] {
  if (!Array.isArray(e)) return [];
  return e.filter((c): c is SExpr[] => Array.isArray(c) && c[0] === head);
}

export function child(e: SExpr, head: string): SExpr[] | undefined {
  return children(e, head)[0];
}
