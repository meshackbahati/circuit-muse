/**
 * Schematic view: the live circuit drawn as a schematic (plain SVG).
 *
 * Generated from the same netlist + layout as the KiCad export, so what you
 * see here is what KiCad opens. Wheel zooms around the cursor, drag pans,
 * clicking a net label highlights that net everywhere.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { buildSchematicNetlist } from './netlist';
import { layoutSchematic, pinEnd, type SchematicLayout, type PlacedPart, type PlacedLabel, type PlacedPower } from './layout';
import { CHAR_W, pinInnerEnd, powerSymbol, type FieldPos, type SymShape, type SymbolDef } from './symbols';
import { schematicInputFrom, schematicSignature } from './fromStore';
import './SchematicView.css';

interface Props {
  onClose: () => void;
}

const TEXT = 1.27; // KiCad default text size (mm)

export default function SchematicView({ onClose }: Props) {
  const boards = useSimulatorStore((s) => s.boards);
  const components = useSimulatorStore((s) => s.components);
  const wires = useSimulatorStore((s) => s.wires);
  const projectName = useWorkspaceStore((s) => s.projectName || 'circuit-muse-project');

  // Rebuild only when the circuit's structure changes, not on every store
  // update (serial output, LED state, dragging a part around, ...).
  const signature = useMemo(() => schematicSignature(boards, components, wires), [boards, components, wires]);
  const { netlist, layout } = useMemo(() => {
    const nl = buildSchematicNetlist(schematicInputFrom(boards, components, wires));
    return { netlist: nl, layout: layoutSchematic(nl) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportAs = async (format: 'kicad_sch' | 'net' | 'zip') => {
    setExporting(true);
    try {
      const { downloadKicad } = await import('./download');
      await downloadKicad(format, projectName);
    } catch (err) {
      console.error('KiCad export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const empty = netlist.parts.length === 0;

  return (
    <div className="schematic-view" role="region" aria-label="Schematic">
      <div className="schematic-toolbar">
        <span className="schematic-title">Schematic</span>
        {!empty && (
          <span className="schematic-meta">
            {netlist.parts.length} parts · {netlist.nets.length} nets
          </span>
        )}
        {selectedNet && (
          <button type="button" className="schematic-chip" onClick={() => setSelectedNet(null)} title="Clear highlight">
            {selectedNet} ✕
          </button>
        )}
        <span className="schematic-spacer" />
        <button type="button" className="schematic-btn" disabled={empty || exporting} onClick={() => exportAs('kicad_sch')}>
          .kicad_sch
        </button>
        <button type="button" className="schematic-btn" disabled={empty || exporting} onClick={() => exportAs('net')}>
          .net
        </button>
        <button type="button" className="schematic-btn" disabled={empty || exporting} onClick={() => exportAs('zip')}>
          KiCad project
        </button>
        <button type="button" className="schematic-btn schematic-close" onClick={onClose} aria-label="Close schematic">
          ✕
        </button>
      </div>
      {empty ? (
        <div className="schematic-empty">
          <p className="schematic-empty-title">Nothing to draw yet</p>
          <p className="schematic-empty-body">Add a board or parts on the circuit canvas and wire them up. The schematic follows every change.</p>
        </div>
      ) : (
        <PanZoomSvg layout={layout} selectedNet={selectedNet} onSelectNet={setSelectedNet} />
      )}
      {netlist.warnings.length > 0 && !empty && (
        <div className="schematic-warnings" title={netlist.warnings.join('\n')}>
          {netlist.warnings.length} note{netlist.warnings.length > 1 ? 's' : ''}: {netlist.warnings[0]}
        </div>
      )}
    </div>
  );
}

// ── Pan / zoom container ──────────────────────────────────────────────────

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fitBox(layout: SchematicLayout): ViewBox {
  const pad = 10;
  const b = layout.bounds;
  return { x: b.x1 - pad, y: b.y1 - pad, w: b.x2 - b.x1 + pad * 2, h: b.y2 - b.y1 + pad * 2 };
}

function PanZoomSvg({
  layout,
  selectedNet,
  onSelectNet,
}: {
  layout: SchematicLayout;
  selectedNet: string | null;
  onSelectNet: (net: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitBox(layout));
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);

  // Re-fit when the drawing's extent changes (parts added/removed).
  const fitKey = `${Math.round(layout.bounds.x2)}x${Math.round(layout.bounds.y2)}`;
  useEffect(() => {
    setVb(fitBox(layout));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(m.inverse());
  }, []);

  // Native, non-passive wheel listener so the page doesn't scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      if (!p) return;
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015);
      setVb((v) => {
        const w = Math.min(Math.max(v.w * k, 10), 5000);
        const s = w / v.w;
        return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toSvg]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const m = svg.getScreenCTM();
    const scale = m ? m.a : 1;
    setVb({ ...d.vb, x: d.vb.x - dx / scale, y: d.vb.y - dy / scale });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const net = (e.target as Element).closest?.('[data-net]')?.getAttribute('data-net') ?? null;
      onSelectNet(net);
    }
  };

  const zoomBy = (k: number) =>
    setVb((v) => {
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return { x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k };
    });

  return (
    <div className="schematic-canvas">
      <svg
        ref={svgRef}
        className="schematic-svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <SchematicDrawing layout={layout} selectedNet={selectedNet} />
      </svg>
      <div className="schematic-zoom">
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setVb(fitBox(layout))} aria-label="Fit to view">
          Fit
        </button>
      </div>
    </div>
  );
}

// ── Drawing ───────────────────────────────────────────────────────────────

/** The schematic itself (SVG group), without pan/zoom chrome. */
export const SchematicDrawing = memo(function SchematicDrawing({ layout, selectedNet }: { layout: SchematicLayout; selectedNet: string | null }) {
  return (
    <g className="sch-drawing">
      {layout.stubs.map((s, i) => (
        <line key={`w${i}`} className="sch-wire" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
      ))}
      {layout.parts.map((pp) => (
        <PartGlyph key={pp.part.ref} pp={pp} />
      ))}
      {layout.labels.map((l, i) => (
        <NetLabel key={`l${i}`} label={l} active={l.net === selectedNet} />
      ))}
      {layout.powers.map((p, i) => (
        <PowerGlyph key={`p${i}`} power={p} active={p.net === selectedNet} />
      ))}
      {layout.noConnects.map((n, i) => (
        <g key={`nc${i}`} className="sch-nc">
          <line x1={n.x - 0.635} y1={n.y - 0.635} x2={n.x + 0.635} y2={n.y + 0.635} />
          <line x1={n.x - 0.635} y1={n.y + 0.635} x2={n.x + 0.635} y2={n.y - 0.635} />
        </g>
      ))}
    </g>
  );
});

function strokeW(w?: number): number {
  return Math.max(w ?? 0, 0.1524);
}

function Shape({ s }: { s: SymShape }) {
  const cls = s.fill === 'outline' ? 'sch-body sch-fill-outline' : s.fill === 'background' ? 'sch-body sch-fill-bg' : 'sch-body';
  if (s.kind === 'rect') {
    return (
      <rect
        className={cls}
        x={Math.min(s.x1, s.x2)}
        y={Math.min(s.y1, s.y2)}
        width={Math.abs(s.x2 - s.x1)}
        height={Math.abs(s.y2 - s.y1)}
        strokeWidth={strokeW(s.width)}
      />
    );
  }
  if (s.kind === 'poly') {
    return <polyline className={cls} points={s.pts.map(([x, y]) => `${x},${y}`).join(' ')} strokeWidth={strokeW(s.width)} />;
  }
  return <circle className={cls} cx={s.cx} cy={s.cy} r={s.r} strokeWidth={strokeW(s.width)} />;
}

function anchorOf(j?: 'left' | 'right'): 'start' | 'end' | 'middle' {
  return j === 'left' ? 'start' : j === 'right' ? 'end' : 'middle';
}

function Field({ x, y, f, text, className }: { x: number; y: number; f: FieldPos; text: string; className: string }) {
  if (f.hide || !text) return null;
  return (
    <text className={className} x={x + f.x} y={y - f.y} textAnchor={anchorOf(f.justify)} dominantBaseline="central" fontSize={TEXT}>
      {text}
    </text>
  );
}

const PartGlyph = memo(function PartGlyph({ pp }: { pp: PlacedPart }) {
  const sym: SymbolDef = pp.part.symbol;
  return (
    <g className="sch-part">
      <title>{`${pp.part.ref} — ${pp.part.value} (${pp.part.type})`}</title>
      <g transform={`translate(${pp.x} ${pp.y}) scale(1 -1)`}>
        {sym.shapes.map((s, i) => (
          <Shape key={i} s={s} />
        ))}
        {sym.pins.map((p) => {
          const [ix, iy] = pinInnerEnd(p);
          return <line key={p.number} className="sch-pin" x1={p.x} y1={p.y} x2={ix} y2={iy} />;
        })}
      </g>
      {(sym.showPinNames || sym.showPinNumbers) &&
        sym.pins.map((p) => {
          const [ix, iy] = pinInnerEnd(p);
          const [ex, ey] = pinEnd(pp.x, pp.y, p);
          const inX = pp.x + ix;
          const inY = pp.y - iy;
          const horizontal = p.angle === 0 || p.angle === 180;
          const toward = p.angle === 0 ? 1 : p.angle === 180 ? -1 : 0;
          return (
            <g key={`t${p.number}`}>
              {sym.showPinNames && horizontal && (
                <text
                  className="sch-pin-name"
                  x={inX + toward * sym.pinNameOffset}
                  y={inY}
                  textAnchor={toward > 0 ? 'start' : 'end'}
                  dominantBaseline="central"
                  fontSize={TEXT}
                >
                  {p.name}
                </text>
              )}
              {sym.showPinNumbers && horizontal && (
                <text
                  className="sch-pin-num"
                  x={(ex + inX) / 2}
                  y={ey - 0.5}
                  textAnchor="middle"
                  fontSize={TEXT * 0.8}
                >
                  {p.number}
                </text>
              )}
            </g>
          );
        })}
      <Field x={pp.x} y={pp.y} f={sym.refField} text={pp.part.ref} className="sch-ref" />
      <Field x={pp.x} y={pp.y} f={sym.valueField} text={pp.part.value} className="sch-value" />
    </g>
  );
});

function NetLabel({ label, active }: { label: PlacedLabel; active: boolean }) {
  const h = 2.2;
  const len = label.net.length * CHAR_W * 0.92 + h;
  const vertical = label.angle === 90 || label.angle === 270;
  const dir = label.angle === 0 || label.angle === 90 ? 1 : -1;
  const pts = [
    [0, 0],
    [dir * (h / 2), -h / 2],
    [dir * (len + h / 2), -h / 2],
    [dir * (len + h / 2), h / 2],
    [dir * (h / 2), h / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
  return (
    <g
      className={`sch-label${active ? ' is-active' : ''}`}
      data-net={label.net}
      transform={`translate(${label.x} ${label.y})${vertical ? ' rotate(-90)' : ''}`}
    >
      <polygon points={pts} />
      <text x={dir * (h / 2 + 0.5)} y={0} textAnchor={dir > 0 ? 'start' : 'end'} dominantBaseline="central" fontSize={TEXT}>
        {label.net}
      </text>
    </g>
  );
}

function PowerGlyph({ power, active }: { power: PlacedPower; active: boolean }) {
  const sym = powerSymbol(power.net);
  const r = (power.rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(r));
  const s = Math.round(Math.sin(r));
  const f = sym.valueField;
  const vx = f.x * c - f.y * s;
  const vy = f.x * s + f.y * c;
  return (
    <g className={`sch-power${active ? ' is-active' : ''}`} data-net={power.net}>
      <g transform={`translate(${power.x} ${power.y}) rotate(${-power.rotation}) scale(1 -1)`}>
        {sym.shapes.map((sh, i) => (
          <Shape key={i} s={sh} />
        ))}
      </g>
      <text x={power.x + vx} y={power.y - vy} textAnchor="middle" dominantBaseline="central" fontSize={TEXT}>
        {power.net}
      </text>
    </g>
  );
}
