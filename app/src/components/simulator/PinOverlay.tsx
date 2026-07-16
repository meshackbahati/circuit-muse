/**
 * PinOverlay Component
 *
 * Renders clickable pin indicators over components to enable wire creation.
 * Shows when hovering over a component or when creating a wire.
 *
 * On touch devices the hit-target is scaled up inversely to the canvas zoom
 * so the *screen-space* tap area stays at least ~40px regardless of zoom level.
 */

import React, { useEffect, useState } from 'react';
import { useIsCoarsePointer } from '../../utils/useTouchDevice';

/** Minimum visual pin size in *world* pixels at zoom 1 */
const PIN_VISUAL = 12;

/** Desired minimum screen-space hit-target size for touch (px) */
const TOUCH_MIN_SCREEN_PX = 44;

/**
 * Hard ceiling for the world-space pin size, in CSS pixels.
 * At very low zoom, `TOUCH_MIN_SCREEN_PX / zoom` would otherwise produce
 * massive overlays that cover the whole board.
 */
const PIN_WORLD_MAX = 28;

interface PinInfo {
  name: string;
  x: number; // CSS pixels
  y: number; // CSS pixels
  signals?: Array<{ type: string; signal?: string }>;
}

interface PinOverlayProps {
  componentId: string;
  componentX: number;
  componentY: number;
  onPinClick: (componentId: string, pinName: string, x: number, y: number) => void;
  showPins: boolean;
  /** Extra offset to compensate for wrapper padding (4) + border (2) = 6 on each side. Default 6/6 for component wrappers. Pass 0 when the element has no wrapper (e.g. boards rendered without DynamicComponent). */
  wrapperOffsetX?: number;
  wrapperOffsetY?: number;
  /** Current canvas zoom level — used to keep touch targets usable at any zoom */
  zoom?: number;
  /**
   * CSS rotation (degrees) applied to the underlying DynamicComponent
   * wrapper. The overlay div lives OUTSIDE that wrapper so it doesn't
   * inherit the transform — without this prop we rotate the pin
   * coordinates manually around the wrapper's centre so the clickable
   * boxes follow the visually-rotated pin tips.
   */
  rotation?: number;
}

export const PinOverlay: React.FC<PinOverlayProps> = ({
  componentId,
  componentX,
  componentY,
  onPinClick,
  showPins,
  wrapperOffsetX = 6,
  wrapperOffsetY = 6,
  zoom = 1,
  rotation = 0,
}) => {
  const [pins, setPins] = useState<PinInfo[]>([]);
  const [wrapperBox, setWrapperBox] = useState<{ w: number; h: number } | null>(null);
  const isCoarse = useIsCoarsePointer();

  useEffect(() => {
    const tryRead = () => {
      const element = document.getElementById(componentId);
      if (element && (element as any).pinInfo) {
        setPins((element as any).pinInfo);
        // Capture the wrapper's unrotated bounding box for the rotation
        // pivot. offsetWidth/Height stay constant regardless of CSS
        // transforms, so they reflect the LAYOUT box — exactly what
        // CSS rotates around with transform-origin: center center.
        const wrapper = element.closest('.dynamic-component-wrapper') as HTMLElement | null;
        if (wrapper) {
          setWrapperBox({ w: wrapper.offsetWidth, h: wrapper.offsetHeight });
        }
        return true;
      }
      return false;
    };
    if (!tryRead()) {
      // Retry once after a tick in case the element sets pinInfo asynchronously (e.g. via useEffect)
      const t = setTimeout(tryRead, 50);
      return () => clearTimeout(t);
    }
  }, [componentId, rotation]);

  if (!showPins || pins.length === 0) {
    return null;
  }

  // On touch-primary devices, compute world-space size so the pin is at least
  // TOUCH_MIN_SCREEN_PX on screen — but clamp to PIN_WORLD_MAX so very low
  // zoom levels can't produce gigantic overlays. On desktop, keep PIN_VISUAL.
  const pinSize = isCoarse
    ? Math.min(PIN_WORLD_MAX, Math.max(PIN_VISUAL, TOUCH_MIN_SCREEN_PX / zoom))
    : PIN_VISUAL;
  const pinHalf = pinSize / 2;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${componentX + wrapperOffsetX}px`,
        top: `${componentY + wrapperOffsetY}px`,
        pointerEvents: 'none',
        zIndex: 30, // Above wires (20) and components, below modals/dialogs (1000+)
      }}
    >
      {pins.map((pin, index) => {
        // Container origin in CANVAS = (componentX + wrapperOffsetX,
        // componentY + wrapperOffsetY) — i.e. shifted INTO the wrapper
        // by the wrapper's padding+border so pin.x can be added directly.
        // The wrapper itself sits at (componentX, componentY), so its
        // top-left in container-local coords is (-wrapperOffsetX,
        // -wrapperOffsetY). CSS rotates around the wrapper's centre.
        let pinX = pin.x;
        let pinY = pin.y;
        const angle = ((rotation % 360) + 360) % 360;
        if (angle !== 0 && wrapperBox) {
          const wrapperLeftLocal = -wrapperOffsetX;
          const wrapperTopLocal = -wrapperOffsetY;
          const pivotX = wrapperLeftLocal + wrapperBox.w / 2;
          const pivotY = wrapperTopLocal + wrapperBox.h / 2;
          const theta = (angle * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const dx = pin.x - pivotX;
          const dy = pin.y - pivotY;
          pinX = pivotX + dx * cos - dy * sin;
          pinY = pivotY + dx * sin + dy * cos;
        }

        return (
          <div
            key={`${pin.name}-${index}`}
            data-pin-overlay="true"
            onClick={(e) => {
              e.stopPropagation();
              onPinClick(
                componentId,
                pin.name,
                componentX + wrapperOffsetX + pinX,
                componentY + wrapperOffsetY + pinY,
              );
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onPinClick(
                componentId,
                pin.name,
                componentX + wrapperOffsetX + pinX,
                componentY + wrapperOffsetY + pinY,
              );
            }}
            style={{
              position: 'absolute',
              left: `${pinX - pinHalf}px`,
              top: `${pinY - pinHalf}px`,
              width: `${pinSize}px`,
              height: `${pinSize}px`,
              borderRadius: '3px',
              backgroundColor: 'rgba(0, 200, 255, 0.8)',
              border: '1.5px solid white',
              cursor: 'crosshair',
              pointerEvents: 'all',
              transition: 'all 0.15s',
              touchAction: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 255, 100, 1)';
              e.currentTarget.style.transform = 'scale(1.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 200, 255, 0.8)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title={pin.name}
          />
        );
      })}
    </div>
  );
};
