# test_custom_chips

Sandbox aislado para validar el sistema de **custom chips** de Velxio antes de integrarlo
al frontend. Cero dependencia de Wokwi.

## Objetivos

1. Probar que se puede cargar un `.wasm` (chip compilado a partir de C) y enrutarlo al simulador.
2. Probar que un sketch de Arduino real (`.hex` compilado con `arduino-cli`) puede comunicarse
   con el chip vía GPIO e I2C.
3. Mantener fidelidad 1:1 con la infraestructura de Velxio (`PinManager`, `I2CBusManager`,
   `AVRSimulator`) para que el código que se valide acá sea trivial de portar.

## Estructura

```
test_custom_chips/
├── package.json
├── README.md
├── vitest.config.js
├── sdk/
│   ├── include/
│   │   └── velxio-chip.h            ← API que ven los chips
│   └── examples/
│       ├── inverter.c
│       ├── inverter.chip.json
│       ├── eeprom-24c01.c
│       └── eeprom-24c01.chip.json
├── scripts/
│   ├── compile-chip.sh              ← clang invocation Linux/macOS
│   ├── compile-chip.ps1             ← clang invocation Windows
│   ├── compile-all.sh               ← compila todos los ejemplos
│   └── setup-wasi-sdk.md            ← cómo instalar wasi-sdk
├── src/                             ← runtime y mirrors de Velxio
│   ├── ChipRuntime.js               ← loader WASM + host imports
│   ├── WasiShim.js                  ← WASI mínimo (fd_write, proc_exit)
│   ├── PinManager.js                ← espejo de Velxio
│   ├── I2CBus.js                    ← espejo del I2CBusManager
│   ├── AVRHarness.js                ← avr8js wrapper Velxio-fiel
│   ├── intelHex.js                  ← parser
│   └── index.js
├── fixtures/                        ← .wasm compilados + .hex sketches
└── test/
    ├── js/                          ← tests que NO requieren clang
    │   ├── 01_pin_manager.test.js
    │   ├── 02_i2c_bus.test.js
    │   ├── 03_avr_harness.test.js
    │   └── 04_runtime_imports.test.js
    └── e2e/                         ← tests que requieren .wasm compilado
        ├── 05_chip_inverter.test.js
        └── 06_chip_eeprom_24c01.test.js
```

## Quickstart

```bash
# 1. Instalar deps
cd test/test_custom_chips
npm install

# 2. (Solo para tests E2E) instalar wasi-sdk siguiendo scripts/setup-wasi-sdk.md

# 3. (Solo para tests E2E) compilar los ejemplos
npm run compile:examples

# 4. Correr tests
npm test            # todo
npm run test:js     # solo tests JS-only (no requieren wasi-sdk)
npm run test:e2e    # solo E2E con WASM
```

Los tests `e2e/` se hacen `it.skip` automáticamente si el `.wasm` correspondiente no
está en `fixtures/`. Eso permite correr la suite parcialmente sin tener `wasi-sdk` instalado.

## Por qué un sandbox separado

Igual que `test_circuit/` validó el solver SPICE antes de integrarlo, este sandbox valida
el runtime de chips antes de tocar el frontend de Velxio. Cuando los tests pasen end-to-end,
los archivos de `src/` se portan al frontend (con tipado TS) e integran con el editor.

## Estado actual

Ver `../autosearch/04_findings.md` para el log corrido de qué funciona y qué falta.
