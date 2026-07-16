# 06 — Recomendaciones / plan accionable

## Decisión propuesta

**No agregar ESP32-P4 como board emulable hoy.** Sumarlo en estado "compilable, no emulable" tiene un valor marginal (el usuario ve el ELF generado, pero al pulsar Run no pasa nada útil) y crea expectativa que no se puede cumplir.

Sin embargo, **toda la plomería de toolchain** se puede dejar lista hoy con muy poco esfuerzo, de modo que el día que `espressif/qemu` mergee la máquina P4, sumar el board sea cuestión de un PR de ~50 líneas.

## Plan en 3 fases

### Fase A — Hoy (preparación, sin exponer al usuario)

Esfuerzo: ~2 h. Riesgo: bajo. **No** agrega un board nuevo en el frontend.

1. **Refactor mínimo en `arduino_cli.py`**: renombrar `_is_esp32c3_board` → `_is_esp32_riscv_board` y extender la lista a `esp32c3, esp32c6, esp32h2, esp32p4`. Misma lógica de `bootloader_offset = 0x0000`. ~10 líneas.
2. **Subscribirse al [issue #127 de espressif/qemu](https://github.com/espressif/qemu/issues/127)** para enterarse cuando aterrice la máquina P4.
3. **Mantener este folder `test/test-esp32-p4/`** como referencia viva — actualizar `01_findings.md` cada vez que haya un release de `espressif/qemu`.

### Fase B — Cuando QEMU soporte ESP32-P4

Esfuerzo: ~1-2 días. Riesgo: medio (depende de qué peripherals emule realmente la máquina).

1. **Backend (`esp_qemu_manager.py`)**:
   - Agregar `'esp32-p4': (QEMU_RISCV32, 'esp32p4')` al `_MACHINE` dict.
   - Forzar `wifi_enabled = False` para P4 (chip sin radio nativa) — devolver warning explícito si el usuario lo activa.
2. **Frontend (`types/board.ts`)**:
   - Agregar `'esp32-p4'` a `BoardKind`.
   - Agregar a `BOARD_KIND_LABELS` con label "ESP32-P4 Dev Module".
   - Agregar a `BOARD_SUPPORTS_MICROPYTHON` (MicroPython tiene puerto P4 desde mediados 2025).
3. **Pin mapping (`utils/boardPinMapping.ts`)**:
   - Mapear los 55 GPIOs según pinout del Dev Module Espressif. Patrón idéntico al ESP32-S3.
4. **Componente visual**:
   - SVG nuevo en `components-wokwi/` (no hay element open en `wokwi-elements`). Alternativa de bajo esfuerzo: reutilizar el SVG del ESP32-S3 con renombrado de pines, hasta tener un dibujo propio.
5. **Smoke test**: `test/test-esp32-p4/scripts/smoke.sh` que (a) compila blink, (b) lanza `qemu-system-riscv32 -M esp32p4 -drive ...`, (c) verifica que aparece "ESP32-P4 blink starting" en el TCP serial.
6. **Tests backend**: agregar caso ESP32-P4 a `test/esp32/test_esp32_integration.py`.

### Fase C — Wi-Fi mock (opcional, cuando haya demanda real)

Cuando un usuario reporte que quiere usar `WiFi.h` con ESP32-P4, implementar mock por parsing del UART (mismo patrón que `wifi_status_parser.py` ya usa para C3). El bus SDIO al C6 emulado real es prohibitivo y se puede ignorar.

## Lo que NO hacer

- ❌ No empezar a portar `rp2040js` a "esp32p4js". Es un proyecto de años y duplica esfuerzo de Wokwi/Espressif.
- ❌ No mergear el board en producción sin el QEMU operacional. Da una mala primera impresión.
- ❌ No comprometerse con Wi-Fi/BLE para este chip. La radio externa C6 es una bestia distinta.
- ❌ No usar QEMU-WASM para P4 mientras el backend QEMU funcione bien para los otros ESP32. Costo (~40 MB WASM extra) > beneficio.

## Métrica de éxito

Cuando se ejecute Fase B, el criterio de aceptación es:
- `arduino-cli compile --fqbn esp32:esp32:esp32p4 blink` produce ELF (ya OK).
- En Velxio, seleccionar board "ESP32-P4 Dev Module" + Run reproduce el LED parpadeando + Serial Monitor muestra "HIGH/LOW" cada 500 ms.
- Smoke test CI verde.

## Cómo monitorear el bloqueante

- GitHub: watch [espressif/qemu releases](https://github.com/espressif/qemu/releases).
- Issue principal: [#127](https://github.com/espressif/qemu/issues/127).
- Mirror: [esp-toolchain-docs/qemu](https://github.com/espressif/esp-toolchain-docs/tree/main/qemu).

Cuando aparezca `hw/riscv/esp32p4.c` en `esp-develop`, activar Fase B.
