# 04 — Vía QEMU backend (la realista, pero bloqueada)

Velxio ya tiene la infraestructura para emular ESP32 vía QEMU. Sumar P4 sería trivial **si la máquina existiera**.

## Estado actual del soporte QEMU

| Fork | Última versión revisada | ESP32-P4 |
|---|---|---|
| `espressif/qemu` (oficial) | `esp-develop-9.2.2-20260417` | ❌ no implementado. Carpeta `hw/riscv` solo tiene `esp32c3.c`, `esp32c3_clk.c`, `esp32c3_intmatrix.c`. [Issue #127 abierto desde 2025-05](https://github.com/espressif/qemu/issues/127), label "Status: To Do". |
| `lcgamboa/qemu` (PICSimLab) | `picsimlab-esp32` | ❌ solo ESP32 + C3. README enumera explícitamente esos dos. |
| `Ebiroll/qemu_esp32` | base 9.2 | ❌ ESP32 Xtensa + S2; no menciona P4. |
| `epiclabs-uc/qemu-esp32` | espejo Espressif | ❌ |
| `max1220/qemu-esp32` | base Espressif + patches | ❌ |

**No existe ningún fork público de QEMU que emule ESP32-P4 al 2026-05-06.**

## Cuando exista — cambios necesarios en Velxio

### Backend

`backend/app/services/esp_qemu_manager.py:41`:
```python
_MACHINE: dict[str, tuple[str, str]] = {
    'esp32':    (QEMU_XTENSA,  'esp32'),
    'esp32-s3': (QEMU_XTENSA,  'esp32s3'),
    'esp32-c3': (QEMU_RISCV32, 'esp32c3'),
    'esp32-p4': (QEMU_RISCV32, 'esp32p4'),  # ← nuevo
}
```

`backend/app/services/arduino_cli.py:212`:
```python
def _is_esp32_riscv_board(self, fqbn: str) -> bool:
    """ESP32 RISC-V variants: C3, C6, H2, P4."""
    return any(s in fqbn for s in ('esp32c3', 'esp32c6', 'esp32h2', 'esp32p4'))
```
y reemplazar la única call a `_is_esp32c3_board(...)` en línea 369 por `_is_esp32_riscv_board(...)`. (Bootloader offset 0x0000 es el mismo para todas las P-cores RISC-V.)

`backend/app/services/esp32_lib_manager.py:73-76` (mapping a libs PICSimLab):
```python
'esp32-p4': 'esp32p4-picsimlab',  # ← cuando el fork lcgamboa lo soporte
```
Hasta que esto exista, el backend tendría que **rutar P4 al binario QEMU oficial Espressif**, no al `lcgamboa` con bibliotecas PICSimLab. Se pierde Wi-Fi/BLE simulado, pero el chip P4 tampoco tiene radio nativa, así que es coherente.

### NIC / Wi-Fi

`esp_qemu_manager.py:213` actualmente hace:
```python
nic_model = 'esp32c3_wifi' if 'c3' in machine else 'esp32_wifi'
```

Para P4 esto **no aplica** porque el chip no tiene radio. Wi-Fi en hardware real viene de un ESP32-C6 externo por SDIO. Opciones cuando llegue QEMU:

1. **Sin Wi-Fi en P4**: forzar `wifi_enabled = False` siempre. Si el sketch llama `WiFi.begin()`, simplemente reportar timeout. Pragmático.
2. **Wi-Fi mock**: interceptar a nivel serial los strings de IDF (`wifi:state: init -> auth`) ya que `wifi_status_parser.py` ya parsea esos. Permitiría UI verde "conectado" sin emular el bus SDIO. Más trabajo, mejor UX.
3. **Bus SDIO emulado al C6**: imposible hoy, complejidad de meses.

Recomendación: opción **1** al inicio, opción **2** después si hay demanda.

### Frontend

`frontend/src/types/board.ts:1`:
```ts
export type BoardKind =
  | ...
  | 'esp32-p4';   // ← agregar
```

`frontend/src/utils/boardPinMapping.ts`: agregar mapping pin-name → GPIO number para los 55 GPIOs del P4 (ver Espressif datasheet §3.4).

`frontend/src/store/useSimulatorStore.ts`: registrar el board en el factory de boards.

## Roadmap estimado upstream

Sin información oficial de Espressif sobre fechas. Patrón histórico:
- ESP32-C3 fue añadido a `espressif/qemu` ~6-8 meses después del lanzamiento del chip.
- ESP32-S3 ~12 meses después.
- ESP32-P4 lleva ~3 años en el mercado y aún sin QEMU.

**No es razonable esperar una fecha**. Vale la pena suscribirse al [issue #127](https://github.com/espressif/qemu/issues/127) y a las [releases](https://github.com/espressif/qemu/releases).
