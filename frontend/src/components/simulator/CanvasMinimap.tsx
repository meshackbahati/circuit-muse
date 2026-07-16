/**
 * CanvasMinimap — bottom-right corner overview of the whole canvas with a
 * draggable viewport rectangle.
 *
 * Geometry mirrors the canvas:
 *   .canvas-world is 4000×3000 px in world space.
 *   .canvas-content is the viewport, sized to the available area at runtime.
 *   .canvas-world's transform is `translate(pan.x, pan.y) scale(zoom)`.
 *
 * The minimap is MINIMAP_W × MINIMAP_H. SCALE = MINIMAP_W / WORLD_W = 0.05.
 * A world point (wx, wy) renders at (wx * SCALE, wy * SCALE).
 *
 * The viewport rectangle drawn inside the minimap shows what fraction of
 * the world is currently visible:
 *   rect.x = -pan.x / zoom * SCALE
 *   rect.y = -pan.y / zoom * SCALE
 *   rect.w = viewport.width  / zoom * SCALE
 *   rect.h = viewport.height / zoom * SCALE
 *
 * Interaction:
 *   - Mouse / touch down OUTSIDE the rectangle → teleport: re-center the
 *     viewport on the clicked world point.
 *   - Mouse / touch down INSIDE the rectangle → drag mode: live-pan the
 *     canvas. Inverse of (delta in minimap space) → world delta.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Component } from '../../types/components';
import type { BoardInstance } from '../../types/board';
import './CanvasMinimap.css';

const MINIMAP_W = 100;
const MINIMAP_H = 75;
const WORLD_W = 4000;
const WORLD_H = 3000;
const SCALE_X = MINIMAP_W / WORLD_W;
const SCALE_Y = MINIMAP_H / WORLD_H;
// Board footprint is ~120 × 90 in world units; render at that size so the
// minimap actually shows where each board lives.
const BOARD_W_WORLD = 120;
const BOARD_H_WORLD = 90;

interface Props {
  pan: { x: number; y: number };
  zoom: number;
  setPan: (p: { x: number; y: number }) => void;
  components: Component[];
  boards: BoardInstance[];
  /** Ref to the .canvas-content element — we read its size to compute the
   *  viewport rectangle, since the canvas viewport changes when the user
   *  resizes their window or toggles a sidebar. */
  viewportRef: React.RefObject<HTMLElement>;
}

export const CanvasMinimap: React.FC<Props> = ({
  pan,
  zoom,
  setPan,
  components,
  boards,
  viewportRef,
}) => {
  // Visible viewport size in CSS pixels — listens for resize so the
  // rectangle stays accurate when the user opens / closes side panels.
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setVp({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  // The viewport rectangle in minimap coordinates.
  const rectX = (-pan.x / zoom) * SCALE_X;
  const rectY = (-pan.y / zoom) * SCALE_Y;
  const rectW = (vp.w / zoom) * SCALE_X;
  const rectH = (vp.h / zoom) * SCALE_Y;

  // Clamp the rectangle to the minimap bounds so it never paints outside
  // (transiently during pinch-zoom-out, and persistently when the user
  // pans past a world edge).  We hit-test against these clamped values
  // too — otherwise clicking the visible red rect can fall outside the
  // unclamped logical rect and erroneously trigger a teleport instead
  // of a drag.
  const clampedW = Math.min(rectW, MINIMAP_W);
  const clampedH = Math.min(rectH, MINIMAP_H);
  const clampedX = Math.max(0, Math.min(MINIMAP_W - clampedW, rectX));
  const clampedY = Math.max(0, Math.min(MINIMAP_H - clampedH, rectY));

  // Drag state. We use a ref + window listeners (rather than React's
  // onMouseMove on the minimap div) so the gesture keeps working even if
  // the cursor leaves the minimap during a fast pan.
  const dragRef = useRef<
    | {
        // Mouse position at mousedown.
        mouseX: number;
        mouseY: number;
        // Pan at mousedown — we add (delta-converted-to-world) to this.
        panX: number;
        panY: number;
      }
    | null
  >(null);

  const minimapRef = useRef<HTMLDivElement>(null);

  // Clamp pan so the viewport rectangle never escapes the minimap. World
  // is 4000×3000; minimum visible is whatever fits at the current zoom.
  const clampPan = useCallback(
    (next: { x: number; y: number }): { x: number; y: number } => {
      // Visible-area limits expressed in pan-space:
      //   pan.x = 0          → world x=0 at left edge of viewport.
      //   pan.x = -(WORLD_W*zoom - vp.w) → world right edge at right of viewport.
      const minX = -(WORLD_W * zoom - vp.w);
      const minY = -(WORLD_H * zoom - vp.h);
      return {
        x: Math.min(0, Math.max(minX, next.x)),
        y: Math.min(0, Math.max(minY, next.y)),
      };
    },
    [zoom, vp.w, vp.h],
  );

  const teleportTo = useCallback(
    (worldX: number, worldY: number) => {
      // Center the viewport on (worldX, worldY).
      setPan(
        clampPan({
          x: -worldX * zoom + vp.w / 2,
          y: -worldY * zoom + vp.h / 2,
        }),
      );
    },
    [zoom, vp.w, vp.h, setPan, clampPan],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const minimap = minimapRef.current;
      if (!minimap) return;
      const rect = minimap.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const insideRect =
        localX >= clampedX &&
        localX <= clampedX + clampedW &&
        localY >= clampedY &&
        localY <= clampedY + clampedH;
      if (insideRect) {
        // Drag mode — record start state, window listeners do the rest.
        dragRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        // Teleport — convert minimap-local click to world coords.
        teleportTo(localX / SCALE_X, localY / SCALE_Y);
      }
    },
    [clampedX, clampedY, clampedW, clampedH, pan, teleportTo],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.mouseX;
      const dy = e.clientY - drag.mouseY;
      // (delta in minimap px) / SCALE = (delta in world units, unscaled).
      // (delta in world units) * zoom = (delta to add to pan, but inverted).
      setPan(
        clampPan({
          x: drag.panX - (dx / SCALE_X) * zoom,
          y: drag.panY - (dy / SCALE_Y) * zoom,
        }),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [zoom, setPan, clampPan]);

  return (
    <div
      ref={minimapRef}
      className="canvas-minimap"
      onPointerDown={onPointerDown}
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
      aria-label="Canvas minimap"
    >
      <div className="canvas-minimap-world">
        {boards.map((b) => (
          <div
            key={b.id}
            className="canvas-minimap-board"
            style={{
              left: b.x * SCALE_X,
              top: b.y * SCALE_Y,
              width: BOARD_W_WORLD * SCALE_X,
              height: BOARD_H_WORLD * SCALE_Y,
            }}
          />
        ))}
        {components.map((c) => (
          <div
            key={c.id}
            className="canvas-minimap-component"
            style={{
              left: c.x * SCALE_X,
              top: c.y * SCALE_Y,
            }}
          />
        ))}
      </div>
      <div
        className="canvas-minimap-viewport"
        style={{
          left: clampedX,
          top: clampedY,
          width: clampedW,
          height: clampedH,
        }}
      />
    </div>
  );
};
