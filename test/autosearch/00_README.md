# Autosearch — Custom Chips para Velxio

Este folder es un cuaderno de bitácora vivo del trabajo para añadir **custom chips** al simulador Velxio.

Reglas:
- Cada hallazgo concreto va a un `.md` con número de orden.
- Cosas que NO funcionaron también se documentan (con la causa y qué se probó).
- Links a recursos externos se citan textualmente con la fecha en que se consultaron.
- No se borra contenido obsoleto: se marca como `~~tachado~~` o se mueve a una sección `## Descartado`.

## Índice de archivos

| # | Archivo | De qué trata |
|---|---|---|
| 00 | `00_README.md` | Este archivo |
| 01 | `01_wokwi_research.md` | Cómo funciona el sistema de chips de Wokwi (referencia) |
| 02 | `02_velxio_chip_api_design.md` | Diseño del API propio (sin código de Wokwi) |
| 03 | `03_wasi_compile_pipeline.md` | Cadena de compilación C → WASM con clang + wasi-sdk |
| 04 | `04_findings.md` | Log corrido de qué funciona / qué no, día a día |
| 05 | `05_open_questions.md` | Decisiones pendientes |
| 06 | `06_wokwi_api_gap_analysis.md` | Comparación con `wokwi-api.h`: qué falta agregar |
| 07 | `07_multi_board_support.md` | Matriz por board (AVR/RP2040/ESP32/etc): qué protocolos funcionan |

## Restricción del proyecto

**Cero código de Wokwi**. Ni `wokwi-cli`, ni `wokwi-api.h`, ni nombres de su API. El stack
es 100% open source pero independiente:

- Toolchain: `clang` (LLVM, Apache 2.0) + `wasi-sdk` (WebAssembly, Apache 2.0).
- API del chip: `velxio-chip.h`, escrita desde cero, naming propio (`vx_*`).
- Loader y runtime: JS puro en `test_custom_chips/src/`.

Si en algún momento se considera importar algo de Wokwi, se discute primero acá.
