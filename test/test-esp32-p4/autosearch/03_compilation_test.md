# 03 — Test de compilación: blink ESP32-P4

## Setup

- `arduino-cli 1.4.1` (commit `e39419312`, 2026-01-19) en `C:/Users/000272869/bin/arduino-cli`.
- Core `esp32:esp32 3.3.8` ya instalado (la última disponible al 2026-05-06).
- Sketch: `test/test-esp32-p4/sketches/blink/blink.ino` (toggle GPIO2 + Serial.println, 25 líneas).

## Comando ejecutado

```bash
cd test/test-esp32-p4/sketches
arduino-cli compile --fqbn esp32:esp32:esp32p4 blink \
  --output-dir ../../binaries/blink   # nota: el flag --output-dir falló, usé el build/ default
```

## Output

```
Sketch uses 312698 bytes (23%) of program storage space. Maximum is 1310720 bytes.
Global variables use 21980 bytes (6%) of dynamic memory, leaving 305700 bytes for local variables. Maximum is 327680 bytes.
```

Exit code: **0**. Tiempo de compilación: ~50 s en frío.

## Artefactos generados

`sketches/blink/build/esp32.esp32.esp32p4/`:

| Archivo | Tamaño | Para qué sirve |
|---|---|---|
| `blink.ino.bin` | 312 880 B | Imagen de la app (sin bootloader). |
| `blink.ino.bootloader.bin` | 21 392 B | Bootloader (offset 0x0000 en flash). |
| `blink.ino.partitions.bin` | 3 072 B | Tabla de particiones (offset 0x8000). |
| `blink.ino.merged.bin` | **4 194 304 B** (4 MB) | Imagen lista para `qemu -drive if=mtd,format=raw`. |
| `blink.ino.elf` | 7 361 896 B | ELF debug; el que abriría GDB. |
| `boot_app0.bin` | 8 192 B | OTA selector. |
| `flash_args` | 172 B | Offsets para `esptool.py write_flash`. |
| `partitions.csv`, `sdkconfig`, `build.options.json`, `blink.ino.map` | misc | metadatos / map de símbolos. |

## Identificación del ELF

```
$ file blink.ino.elf
ELF 32-bit LSB executable, UCB RISC-V, RVC, single-float ABI, version 1 (SYSV),
statically linked, with debug_info, not stripped
```

Confirma:
- **RISC-V 32-bit little-endian** → `qemu-system-riscv32`.
- **RVC** (compressed instructions, RV32C extension).
- **single-float ABI** (`ilp32f`) — el chip tiene FPU single-precision.

## flash_args (offsets para flashing)

```
--flash_mode keep --flash_freq keep --flash_size keep
0x0000 blink.ino.bootloader.bin
0x8000 blink.ino.partitions.bin
0xe000 boot_app0.bin
0x10000 blink.ino.bin
```

Notar: bootloader en **0x0000** (igual que ESP32-C3), no 0x1000 (como ESP32 Xtensa). El switch `bootloader_offset` en `arduino_cli.py:369` ya hace `0x0000 if _is_esp32c3_board(...) else 0x1000`. Para P4 hay que extender ese helper a "ES_RISCV_BOARD" y meter ahí también `esp32p4*`.

## Conclusiones

1. La cadena de toolchain para ESP32-P4 está **lista en arduino-cli sin cambios**.
2. El binary final (`merged.bin` 4 MB) es plug-and-play para QEMU vía `-drive if=mtd,format=raw,file=...` — el mismo patrón que ya usa el `esp_qemu_manager`.
3. Lo único que **falta a nivel toolchain** son ajustes menores en el código de Velxio:
   - `arduino_cli.py`: extender `_is_esp32c3_board()` a un `_is_riscv_esp32()` que cubra C3, C6, P4 y H2 para el offset 0x0000.
   - `compile.py`: aceptar el FQBN `esp32:esp32:esp32p4` como ESP32-family.
4. **No hay forma de probar el ejecutable** hoy — `qemu-system-riscv32 -M esp32p4` no existe.
