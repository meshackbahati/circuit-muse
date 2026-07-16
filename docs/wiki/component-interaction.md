# Component Interaction Model

> How the canvas decides whether a mouse click on a component opens its
> property dialog, starts a drag-to-rearrange, or is forwarded to the
> wokwi web component's own pointer logic (knob rotation, button press,
> joystick stick drag, etc.).

## TL;DR

When a user clicks on a component on the simulator canvas, exactly one
of three things happens:

| Surface clicked | Result |
|-----------------|--------|
| Wrapper border / padding / non-interactive area of any component | Canvas owns the click. Single click = open property dialog; mousedown + threshold movement = drag the component to reposition it. |
| A wokwi web component whose tag is in the **pointer-owning whitelist** below | Wokwi component owns the click. Rotates the knob, presses the button, slides the switch, etc. |
| A wokwi web component NOT in the whitelist (sensor, display, LED, resistor, etc.) | Same as the wrapper case — canvas owns the click. |

## The whitelist

The exhaustive list lives in
[`frontend/src/components/DynamicComponent.tsx`](../../frontend/src/components/DynamicComponent.tsx)
inside `handleMouseDown`. As of this writing it covers:

```ts
const ownsPointer =
  interactionRunning &&
  (tag === 'wokwi-pushbutton'
   || tag === 'wokwi-pushbutton-6mm'
   || tag === 'wokwi-potentiometer'
   || tag === 'wokwi-slide-potentiometer'
   || tag === 'wokwi-slide-switch'
   || tag === 'wokwi-dip-switch-8'
   || tag === 'wokwi-analog-joystick'
   || tag === 'wokwi-ky-040'
   || tag === 'wokwi-membrane-keypad'
   || tag === 'wokwi-rotary-dialer');
```

If you wire a NEW wokwi component that depends on its own internal
`pointerdown` / `pointermove` / `pointerup` handlers, append its custom
element tag here. Otherwise the canvas's `e.stopPropagation()` in the
capture phase will swallow the pointer event before the wokwi component
ever sees it — the knob will not rotate, the button won't report a
press, the joystick stick won't move.

## Why the gate is opt-in (whitelist) rather than opt-out

The gate used to be heuristic: *"if the component has a
PartSimulationRegistry handler (`isInteractive`), let the wokwi
component own the pointerdown."* That heuristic was too broad — DHT22,
HC-SR04, NTC, photoresistor, LED all register `attachEvents` to bridge
the SPICE / sensor-update layers, but visually they have NO internal
pointer logic. The heuristic caused clicks on those components to be
silently swallowed by the wokwi shadow DOM (which did nothing with
them) → property dialog never opened → users couldn't change sensor
values.

A tight whitelist is verifiable in one read and trivial to extend.

## Property dialog flow

For non-pointer-owning components, the mousedown bubbles to
`SimulatorCanvas` which:

1. Tracks the down position and starts a movement-threshold timer.
2. If the user releases the button without moving past ~3 px ⇒ treat as
   click ⇒ open `<ComponentPropertyDialog>` for that component.
3. If the user moves past the threshold ⇒ treat as drag ⇒ reposition the
   component on the canvas grid.

The property dialog renders a `SensorControlPanel` (for sensors that
have `SENSOR_CONTROL_DEFS`) or a generic property editor. The slider
dispatches `dispatchSensorUpdate(componentId, { … })` which routes via
`SensorUpdateRegistry` to the part's `attachEvents` callback. That
callback updates the AVR ADC (`setAdcVoltage`) AND emits a
`PROPERTY_CHANGE_EVENT` so the SPICE netlist gets rebuilt with the new
value (e.g. NTC resistance recalculated from the new temperature).

## Live-simulation vs. edit-mode

The whitelist is only consulted when `interactionRunning` is true —
either the MCU sim is running or this is a board-less SPICE-only
circuit with the electrical simulation un-paused. While the user is in
"edit mode" (sim stopped) the canvas always owns clicks so the user can
arrange components without accidentally rotating knobs.

## Test infrastructure note

CDP-synthesized `PointerEvent` carries `isTrusted = false`. Lit's
gesture machinery (used by wokwi-elements) requires real OS-issued
trusted events. Automated tests that need to rotate a potentiometer or
press a button cannot do it via `dispatchEvent`. Two workarounds:

- For pushbuttons: dispatch the custom `button-press` /
  `button-release` events directly on the wokwi-pushbutton DOM
  element. The Velxio simulation layer reacts to those.
- For rotary / slider components: reach into the wokwi shadow root,
  find the hidden `<input type="range">`, set its `value` via the
  native HTMLInputElement setter, then dispatch a bubbling `input`
  event. Example:

```js
const slider = document.querySelector('wokwi-potentiometer')
  .shadowRoot.querySelector('input[type="range"]');
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
set.call(slider, '512');
slider.dispatchEvent(new Event('input', { bubbles: true }));
```

Real user mouse drag works correctly without any of this — the
whitelist fix is all that was needed for the runtime path.

## Related files

- `frontend/src/components/DynamicComponent.tsx` — the per-component
  wrapper, `handleMouseDown` lives here.
- `frontend/src/components/simulator/SimulatorCanvas.tsx` — owns the
  canvas drag-threshold logic and dialog open dispatch.
- `frontend/src/components/simulator/SensorControlPanel.tsx` — renders
  the slider/button UI for sensor property editing.
- `frontend/src/simulation/SensorUpdateRegistry.ts` — module-level
  singleton bridging the dialog → part `attachEvents` callbacks.
- `frontend/src/simulation/parts/SensorParts.ts`,
  `BasicParts.ts`, `ComplexParts.ts` — the actual per-part handlers
  that consume slider updates.
