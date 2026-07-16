# 05 — Vía frontend (browser): por qué no es viable hoy

El otro patrón de Velxio es ejecutar el emulador **en el browser** (sin backend, sin WebSocket): así corren AVR (`avr8js`) y RP2040 (`rp2040js`). Para ESP32-P4 esta vía está cerrada por falta de un emulador open-source.

## Opciones evaluadas

### 1. Emulador JS dedicado (estilo `avr8js` / `rp2040js`)

**No existe.** Wokwi mantiene `avr8js` y `rp2040js` open-source en GitHub bajo MIT, pero su engine ESP32 (incluido el P4) es **cerrado** y forma parte del producto Wokwi Cloud / Wokwi VS Code. Verificado:

```
$ # listado de repos públicos org wokwi en github
avr8js                # open
rp2040js              # open
esp32p4-hello-world   # solo sketch ejemplo, NO engine
esp32p4-mipi-dsi-panel-demo  # solo sketch ejemplo
esp32-roms            # ROMs reverse-engineered
esp32-test-binaries   # firmware de prueba
# NO HAY: esp32js, esp32p4js, esp32-emulator, etc.
```

Construir un emulador RV32IMAFC + 55 GPIOs + I²C/SPI/UART/I²S/USB/MIPI-DSI desde cero es **trabajo de años** para una sola persona. Out of scope para este proyecto.

### 2. Emuladores RISC-V genéricos (rvemu, riscv-rust, TinyEMU)

| Proyecto | Lenguaje | ISA | ¿Sirve para ESP32-P4? |
|---|---|---|---|
| `d0iasm/rvemu` | Rust + WASM | RV64GC, Sv39, UART/PLIC/CLINT | ❌ apunta a Linux/xv6, no a ESP32 SoC. |
| `takahirox/riscv-rust` | Rust + WASM | RV64IMAFD, Sv39 | ❌ idem. |
| `TinyEMU` (F. Bellard) | C → wasm | RV32IMA, RV64GC | ❌ idem; emula virtio, no ESP32 mem-map. |

El problema no es el CPU — RV32IMAFC es estándar y cualquiera de estos lo ejecuta — el problema son **los periféricos chip-específicos**: GPIO matrix, IO MUX, RTC, SYSCON, INTERRUPT_CORE, USB OTG, etc. **Sin esos, el firmware se cuelga en el bootloader** intentando configurar reloj y memoria.

### 3. QEMU compilado a WASM

Patrón explorado en `test/esp32-emulator/qemu-wasm/Dockerfile` para Xtensa (vía Emscripten). Aplicaría igual al P4 **si `espressif/qemu` tuviera la máquina**, pero como no la tiene, este path está bloqueado por la misma razón que el backend.

Trade-off: aún cuando esté listo, QEMU-WASM:
- pesa ~30-40 MB (chunk lazy-loaded).
- es ~5-10× más lento que QEMU nativo en backend.
- no tiene WebSocket overhead.

Conclusión: **prefiere backend QEMU** sobre QEMU-WASM para ESP32 boards en general. Coincide con la decisión que ya tomó Velxio para C3/S3.

### 4. Espressif IDF Component Manager + QEMU oficial reutilizado en cliente

Imposible: el QEMU oficial es ELF/EXE para Linux/Mac/Windows, no WASM. Habría que recompilarlo (vuelve a opción 3).

## Por qué AVR y RP2040 sí están en frontend

- **AVR**: ISA chiquita (~131 instrucciones, 8-bit). avr8js son ~5 K líneas TS.
- **RP2040**: ARM Cortex-M0+ con set reducido. rp2040js son ~10 K líneas TS y aprovecha que el RP2040 es bien documentado y open silicon.
- **ESP32-P4**: SoC de **última generación** con dual-core, FPU, AI extensions, MMU, cache, MIPI… al menos un orden de magnitud más complejo. Sin la documentación interna (que Espressif solo da parcialmente), el reverse-engineering completo es prohibitivo.

## Veredicto

La vía frontend para ESP32-P4 está **descartada** salvo dos eventos improbables a corto plazo:
- Wokwi libera su engine ESP32 (no hay señales de eso).
- Espressif publica un emulador WASM oficial.

La única vía realista es **backend QEMU cuando exista la máquina** — ver [`04_qemu_backend_path.md`](04_qemu_backend_path.md).
