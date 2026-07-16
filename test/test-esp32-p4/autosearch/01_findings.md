# 01 — Hallazgos sesión 2026-05-06

## Resumen ejecutivo

Sumar ESP32-P4 a Velxio **no es posible hoy con la arquitectura existente** (ni vía backend QEMU ni vía emulador JS frontend), pero **el toolchain de compilación ya funciona** y no hay obstáculo de licencia ni de toolchain. La pieza bloqueante es **la máquina QEMU `esp32p4`**: Espressif aún no la ha implementado en su fork. Wokwi sí simula el chip, pero su engine es propietario.

Recomendación: dejar la rama de **compilación + ELF** lista en backend (cambios mínimos en `arduino_cli.py` y `esp_qemu_manager.py`), y poner el board en estado "compilable, no emulable" hasta que `espressif/qemu` libere la máquina P4. Más detalle en [`06_recommendations.md`](06_recommendations.md).

## Lo que funciona (verificado en esta máquina)

| Pieza | Estado | Evidencia |
|---|---|---|
| Detección de boards ESP32-P4 en `arduino-cli` | ✅ | `arduino-cli board listall` lista 5 variantes (Dev Module, Core Board, FireBeetle 2, 4D Systems MIPI). |
| Core `esp32:esp32 3.3.8` instalado y soporta P4 | ✅ | Ya estaba instalado en el entorno. |
| Compilación de blink mínimo | ✅ | `arduino-cli compile --fqbn esp32:esp32:esp32p4 blink` → exit 0. |
| Output ELF RISC-V 32-bit (RVC, single-float) | ✅ | `file blink.ino.elf` → `ELF 32-bit LSB executable, UCB RISC-V, RVC, single-float ABI`. |
| Tamaños razonables | ✅ | sketch 312 KB / 1310 KB flash; globals 21 KB / 327 KB SRAM. |
| `merged.bin` 4 MB con bootloader + app + partitions | ✅ | Listo para `qemu -drive if=mtd,format=raw` igual que ESP32/C3. |
| arduino-esp32 v3.1.x soporta P4 | ✅ | Confirmado en [arduino-esp32 #10278](https://github.com/espressif/arduino-esp32/issues/10278): GPIO/I2C/SPI/UART/Wi-Fi (vía co-procesador externo)/USB OK. Faltan ADC calibration, BT Classic, DAC, Hall, MCPWM, PCNT, MIPI, MSPI. |

## Lo que NO funciona (bloqueantes)

| Bloqueante | Estado | Por qué |
|---|---|---|
| **Máquina `esp32p4` en `espressif/qemu`** | ❌ | Último release `esp-develop-9.2.2` (2026-04-17) lista solo `esp32`, `esp32-s3`, `esp32c3`. [Issue #127](https://github.com/espressif/qemu/issues/127) abierto desde 2025-05-17, label `Status: To Do`. La carpeta `hw/riscv` del fork solo tiene `esp32c3.c`. |
| **Forks alternativos QEMU con P4** | ❌ | Revisados: `lcgamboa/qemu` (PICSimLab), `Ebiroll/qemu_esp32`, `epiclabs-uc/qemu-esp32`, `max1220/qemu-esp32`. Ninguno menciona P4. |
| **Emulador JS/WASM open-source** | ❌ | Wokwi tiene `avr8js` y `rp2040js` públicos, pero **no** existe `esp32js` o `esp32p4js` open-source. Wokwi simula P4 en beta dentro de su producto cerrado. |
| **Wokwi-elements board element** | ❌ | `wokwi-libs/wokwi-elements/src/` tiene `esp32-devkit-v1-element.ts` pero no `esp32-p4`. El `board-esp32-p4-preview` que aparece en `diagram.json` de Wokwi vive solo en su build privado. |
| **QEMU instalado localmente para smoke test** | ❌ | `qemu-system-riscv32` no está en PATH en esta máquina. El smoke test contra P4 sería igual fútil porque la máquina ni siquiera existe en el binario. |

## Lo que probé (timeline)

1. Compilación local: **OK**, ELF y `merged.bin` generados (ver `03_compilation_test.md`).
2. Búsqueda en `espressif/qemu`: branches (`esp-develop`, `esp-develop-based-on-9.2.2`, `master`) y carpeta `hw/riscv` → ningún archivo `esp32p4*`. [Issue #127](https://github.com/espressif/qemu/issues/127) es la fuente única de verdad: status "To Do".
3. Búsqueda en wokwi-elements: solo `esp32-devkit-v1-element.ts`, sin variante P4.
4. Búsqueda en organización `wokwi` de GitHub: hay `esp32p4-hello-world` y `esp32p4-mipi-dsi-panel-demo` (solo sketches de ejemplo), no engine.
5. Wokwi docs (`/guides/esp32`): confirma que P4 está "in beta" en Wokwi pero sin detalles del engine.

## Implicaciones para Velxio

1. **Backend (`esp_qemu_manager.py`)**: agregar `'esp32-p4': (QEMU_RISCV32, 'esp32p4')` cuando la máquina exista. Bootloader offset y flash layout ya son los mismos del C3 (offset 0x0000, no 0x1000 — patrón ya implementado en `arduino_cli.py:369`).
2. **Frontend (`types/board.ts`)**: agregar `'esp32-p4'` al `BoardKind`. Es **RISC-V**, igual que C3 → entra en el flujo de WebSocket-QEMU, **no** en el flujo browser-emulado (avr8js / rp2040js).
3. **Cosmético**: dibujar un board element. Sin un SVG de wokwi-elements, hay que crear el componente nuevo (ya hay precedente con `esp32-cam` y `wemos-lolin32-lite` que reutilizan el SVG ESP32 base con pin labels distintos).
4. **MicroPython**: el set `BOARD_SUPPORTS_MICROPYTHON` debería incluir `esp32-p4` cuando QEMU corra (MicroPython oficial ya tiene puerto P4).

## Riesgos

- **Wi-Fi/BLE**: el ESP32-P4 no tiene radio. Las plataformas (FireBeetle 2, ESP32-P4-Module) lo combinan con un **ESP32-C6** externo vía SDIO/UART. Esto rompe el modelo NIC actual (`esp32_wifi`, `esp32c3_wifi`). Cuando llegue el QEMU, hay que decidir: (a) modelar también el C6 companion, (b) marcar Wi-Fi como no-emulado y mostrar warning al usuario.
- **MIPI-DSI / CSI**: el chip los tiene, pero ningún emulador (ni siquiera Wokwi) los simula a fondo. Sería out-of-scope.
- **PSRAM**: hasta 32 MB. QEMU puede hacerlo (-m), no es bloqueante.

## Archivos relacionados

- [`02_chip_overview.md`](02_chip_overview.md) — specs y peripherals
- [`03_compilation_test.md`](03_compilation_test.md) — output exacto de la compilación
- [`04_qemu_backend_path.md`](04_qemu_backend_path.md) — qué hace falta en backend cuando QEMU soporte P4
- [`05_frontend_emulation_path.md`](05_frontend_emulation_path.md) — opciones JS/WASM y por qué descartadas
- [`06_recommendations.md`](06_recommendations.md) — plan accionable

## Fuentes

- [arduino-esp32 — Support of ESP32-P4 (#10278)](https://github.com/espressif/arduino-esp32/issues/10278)
- [espressif/qemu — Is QEMU support planned for esp32p4 and esp32c6? (#127)](https://github.com/espressif/qemu/issues/127)
- [espressif/qemu releases](https://github.com/espressif/qemu/releases)
- [Wokwi ESP32 Simulation guide](https://docs.wokwi.com/guides/esp32)
- [ESP32-P4 product page](https://www.espressif.com/en/products/socs/esp32-p4)
