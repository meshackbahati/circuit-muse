# Components Reference

Velxio ships with **150+ interactive electronic components** across 11 categories. Most come from the upstream [wokwi-elements](https://github.com/wokwi/wokwi-elements) library; the rest are Velxio-native parts (logic gates, instruments, op-amps, transistors, e-paper panels, custom chips).

Every component can be placed on the canvas, wired, rotated, configured, and (for analog parts) co-simulated by the on-board **ngspice** engine.

---

## Adding Components

1. Click the **+ Add Component** button on the simulation canvas.
1. Use **search** or browse by **category** in the picker.
1. Click a component to place it on the canvas.
1. **Drag** to reposition, click to open the **Property Dialog** (color, pin assignment, value, rotate, delete).
1. **Double-click** to open the **Pin Selector** for explicit pin-to-board mapping.

---

## Connecting Components

1. Click a **pin** on any component — a wire starts from that pin.
1. Click a **destination pin** to complete the connection.
1. Wires are **color-coded** by signal type:

| Color | Signal type |
|-------|-------------|
| Red | VCC (power) |
| Black | GND (ground) |
| Blue | Analog |
| Green | Digital |
| Purple | PWM |
| Gold | I2C (SDA/SCL) |
| Orange | SPI (MOSI/MISO/SCK) |
| Cyan | USART (TX/RX) |

Wires route orthogonally and snap to the 20px grid. Segments can be dragged perpendicular to their orientation to clean up the layout. Parallel wires automatically offset to avoid overlap.

---

## Catalog (current counts)

Category breakdown straight from `frontend/public/components-metadata.json`:

| Category | Count | Examples |
|----------|------:|----------|
| Boards | 4 | Arduino Uno, Mega, Nano, ATtiny85 footprint stand-ins |
| Displays | 16 | LCD 16x2, LCD 20x4, 7-segment (1/2/4 digits), SSD1306 OLED, ST7735, ILI9341 TFT, NeoPixel matrix, ring, strip, e-paper panels |
| Sensors | 8 | DHT11/22, HC-SR04, PIR, photoresistor, MPU6050, BMP280, NTC thermistor, IR receiver |
| Input | 5 | Pushbutton, slide switch, DIP switch, rotary encoder, analog joystick |
| Output | 5 | LED, RGB LED, LED bar graph, buzzer, servo |
| Motors | 3 | Servo, DC motor, stepper |
| Logic | 25 | 74HC00 series gates, 74HC595 shift reg, 74HC165, 74HC138, 4017, 4051, 4094, D/JK flip-flops, multiplexers, decoders |
| Analog | 31 | Op-amps (LM358, TL081, LM741, …), comparators, voltage references, function gen, voltmeter, ammeter, oscilloscope probes |
| Passive | 34 | Resistors, capacitors (electrolytic / ceramic / film), inductors, diodes (1N4148, 1N4007, Zener, Schottky, LED), transistors (NPN/PNP/2N2222/BC547/MOSFET N/P), potentiometers, trimmers |
| Electromech | 2 | Relay (SPDT), reed switch |
| Other | 19 | Power supplies, GND rails, breadboards, terminal blocks, EEPROM (24Cxx I2C, 25-series SPI), RFID RC522, fingerprint, GPS, RTC (DS1307, DS3231), custom-chip placeholders |

**Total: 152 components.** The number ticks up over time as new chips, sensors, and instruments land.

---

## Velxio-native components (not in wokwi-elements)

These are defined in `scripts/component-overrides.json` (under `_customComponents`) and built into the catalog at generation time. See [Custom components in the metadata generator](./wiki/component-metadata-generator.md) for the full schema.

### Instruments

| Component | Purpose | Notes |
|-----------|---------|-------|
| **Voltmeter** | DC voltage between two probes | Reads from the live ngspice solution every frame |
| **Ammeter** | Current through a series leg | Inserts a 0Ω current-sense source in the netlist |
| **Oscilloscope** | Multi-channel waveform capture | 4 channels, trigger source, time/div, voltage/div, logic-analyzer mode |
| **Function Generator** | Sine / square / triangle / sawtooth out | Configurable freq, amplitude, DC offset, duty cycle |

The instruments are pure analog UI surfaces — drop them on the canvas, wire the probes, and the values update in real time. No code change required.

### Logic gates (discrete)

`AND`, `NAND`, `OR`, `NOR`, `XOR`, `XNOR`, `NOT`, `Buffer` — each as its own canvas component (separate from the 74HC IC variants).

### Power & connectors

Power supply (configurable V), GND rail, 5V rail, 3V3 rail, terminal blocks, breadboards (full + half + mini), DIP/SOP/QFP footprints for custom-chip placeholders.

---

## Analog vs digital co-simulation

Every component on the canvas falls into one of three buckets, transparently:

1. **Pure digital** — LED, button, 7-segment, LCD, NeoPixel. State is driven by `PartSimulationRegistry` (output components) or by injected pin events (input components). MCU pin → component.
1. **Pure analog** — op-amp, transistor, diode, resistor, capacitor, voltmeter. Modeled as SPICE cards by `NetlistBuilder`, solved by the ngspice-WASM engine every frame.
1. **Mixed** — MCU board pins. Each enabled digital pin appears in the netlist as a Thevenin source (0V or VCC, output impedance set by the port driver model). The MCU's ADCs read back the live SPICE node voltage on `analogRead()`.

This is why a potentiometer wired to A0 works without a `setAnalog()` call: the canvas builds a real voltage divider, ngspice solves the node voltage, and the ADC injection pipe samples that voltage on every conversion. Wire an op-amp follower in between and it still works.

Toggle the engine on or off with the **electrical-sim** toggle in the toolbar (lazy-loads the ~39 MB ngspice WASM bundle on first enable). See the [Electrical Simulation User Guide](./wiki/electrical-simulation-user-guide.md) for the full analog workflow.

---

## Custom chips (write your own component)

Velxio ships a custom-chip SDK so you can model parts that aren't in the catalog. Write the chip in C, compile to WebAssembly, drop it on the canvas, wire it up. The gallery includes 30+ ready-to-load examples:

- **Glue logic** — inverter, XOR, pulse counter, latch
- **Shift registers** — SN74HC595, CD4094
- **Memory** — 24C01 / 24LC256 I2C EEPROM, 32K/1M parallel ROM, 64K parallel RAM
- **Vintage CPUs** — Intel 4001, 4002, 4004, 4040, 8080, 8086, 8251, 8253, 8255, 8259
- **Vintage CPUs (alt path)** — Z80, i8080 REPL/counter variants
- **I/O expanders** — PCF8574, MCP3008
- **RTC** — DS3231

See [Custom Chips — Developer Guide](./CUSTOM_CHIPS.md), [API Reference](./wiki/custom-chips-api-reference.md), and [Examples](./wiki/custom-chips-examples.md).

---

## Property Dialog

Click any component to open its property dialog. Properties vary by part, but common ones:

| Property | Applies to | Description |
|----------|------------|-------------|
| Arduino Pin | Digital input / output | The digital or analog pin this part connects to (when not wired) |
| Color | LEDs, wires | RGB hex value for the visual |
| Value | Resistor, capacitor, inductor, op-amp | Component value (10kΩ, 100nF, …) |
| Protocol | LCD, OLED, EEPROM | I2C address, SPI bus selector |
| Rotation | Any | Rotate 90° / 180° / 270° |
| Delete | Any | Remove the component (also cascades wire removal) |

---

## Component metadata pipeline

`frontend/public/components-metadata.json` is **generated** by `scripts/generate-component-metadata.ts`. Direct edits get wiped on the next regen.

- **wokwi-elements components** — auto-discovered by scanning `third-party/wokwi-elements/src/` (clone optional; the npm package doesn't ship the source).
- **Velxio-native components** — defined under `_customComponents` in `scripts/component-overrides.json`.
- **wokwi-elements with richer UI controls** — keyed override in the same file patches `properties` + `defaultValues`.

To regenerate after editing the override file:

```bash
cd frontend
npm run generate:metadata
```

Full pipeline reference: [Component metadata generator](./wiki/component-metadata-generator.md).

---

## Adding a new component

For a wokwi-elements part: it's auto-picked up on the next metadata regen — no code changes needed in Velxio.

For a Velxio-native part:

1. Implement it as a Web Component (`class extends HTMLElement`, `attachShadow`, `pinInfo` getter). See `Esp32Element.ts`, `Bmp280Element.ts`, or `LogicGateElements.ts` for templates.
2. Register the custom element with `customElements.define('velxio-…', FooElement)`.
3. Add the entry to `scripts/component-overrides.json` under `_customComponents`.
4. (Optional) Register a behavior in `PartSimulationRegistry` if the component reacts to pin state changes (output) or fires events (input).
5. Run `npm run generate:metadata`.

**Important:** boards and any component that needs wire connections **must be a real Web Component, not a React SVG.** The wire system reads `element.pinInfo` from the rendered DOM — React SVGs have no `pinInfo` and wires snap to (0, 0) of the parent. See the rule in `CLAUDE.md` (§6a).

---

## See also

- [Custom Chips](./CUSTOM_CHIPS.md) — Write a chip in C
- [Electrical Simulation User Guide](./wiki/electrical-simulation-user-guide.md) — Analog workflow
- [Component metadata generator](./wiki/component-metadata-generator.md) — Pipeline internals
- [E-Paper Emulation](./wiki/epaper-emulation.md) — Waveshare panel driver
- [Component interaction](./wiki/component-interaction.md) — How clicks, drags, and pin events flow
