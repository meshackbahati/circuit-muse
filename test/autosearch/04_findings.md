# Findings — log corrido

Formato: por sesión + fecha. Lo más reciente arriba.

---

## 2026-04-28 (sesión 4) — SPI + 5 chips nuevos + gaps cubiertos

### Resultado

```
Test Files  26 passed | 0 skipped (26)
Tests       70 passed | 0 skipped (70)
```

### Gaps de wokwi-api.h ahora cubiertos

✅ **SPI slave**: nuevo `SPIBus` + `SPIDevice` + `vx_spi_attach`/`start`/`stop`. Modelo
   buffer-bidireccional como Wokwi: chip pre-llena con MISO, master clockea bytes,
   buffer queda con MOSI recibido, fires `on_done(buffer, count)`.
✅ **`VX_OUTPUT_LOW` / `VX_OUTPUT_HIGH`**: modos 16/17 que inicializan el pin a un
   nivel concreto al registrar — elimina la ventana glitch entre register+write.
✅ **`vx_pin_watch_stop`**: por-handle, libera todos los watches del pin.
✅ **`vx_pin_dac_write`**: dispara analog listeners en PinManager (DAC).
✅ **`vx_pin_set_mode`**: cambiar modo después del init (renombrado de pin_mode
   por colisión con el nombre del enum en C).
✅ **`reserved[8]` en configs**: i2c_config = 64 bytes, uart_config = 56 bytes,
   spi_config = 60 bytes. ABI estable hacia adelante.

### Chips nuevos compilados (5)

| Chip | Tamaño | Protocolos | Notas |
|---|---|---|---|
| `sn74hc595.wasm`     | 64 KB | SPI + GPIO + RCLK latch | Shift register 8-bit, latch en RCLK rising |
| `mcp3008.wasm`       | 64 KB | SPI + ANALOG | ADC 8-canales 10-bit |
| `pcf8574.wasm`       | 64 KB | I2C + GPIO bidireccional | I/O expander 8-bit, base 0x20 |
| `ds3231.wasm`        | 64 KB | I2C + estado interno | RTC con 19 registros, BCD encoding |
| `pulse-counter.wasm` | 64 KB | GPIO + atributos | Cuenta flancos, OVF cada N pulsos |

### Tests nuevos (21 más, total 70)

- `14_sn74hc595` — 4 tests: SPI byte transfer, RCLK latching, SRCLR clear, byte override.
- `15_mcp3008`   — 3 tests: 0V/2.5V/5V analog readings via SPI command protocol.
- `16_pcf8574`   — 4 tests: I2C write→pin pattern, read line state, A0..A2 addressing, latched persistence.
- `17_ds3231`    — 3 tests: read default time, set+read time round-trip BCD, register pointer.
- `18_pulse_counter` — 3 tests: default threshold (4), custom threshold attr, RST clear.
- `19_api_extras` — 4 tests: import surface, OUTPUT_HIGH init, OUTPUT_LOW init, DAC dispatch.

### Lo que se aprendió

1. **Re-arm SPI**: chips como 74HC595 que no usan CS deben llamar `vx_spi_start` de
   nuevo dentro del `on_done` callback. Si no, solo el primer byte llega.
2. **Naming collision en C**: `vx_pin_mode` no podía ser tipo Y función. Renombrado a
   `vx_pin_set_mode`. Lección: prefijar funciones distinto del enum/typedef.
3. **Struct ABI con reserved[8]**: agregar campos al final no rompe los chips ya
   compilados solo si las posiciones existentes no se mueven. El `_Static_assert`
   en el header detecta cualquier movimiento accidental.
4. **PinManager.setAnalogVoltage** ya existía y permitió implementar `pin_dac_write`
   sin agregar infraestructura nueva.

### Aún pendiente (deferido)

- Framebuffer para displays (LCD/OLED custom). El IL9163 que pasaste sería el caso
  de uso. Implementarlo cuando sea necesario; SSD1306 / ILI9341 ya están en
  wokwi-elements y no necesitan custom chip.
- `attr_string_init` (atributos texto/select). Caso raro.
- Experimental `_mcu_*` (memoria del CPU emulado). Solo para debug.

---

## 2026-04-28 (sesión 3) — AVR Wire + chip I2C: full E2E

### Resultado

```
Test Files  20 passed | 0 skipped (20)
Tests       49 passed | 0 skipped (49)
```

**Cero tests skipped.** Toda la suite corre verde sin excepción.

### Lo que se completó

- Sketch Arduino real (`sketches/i2c_eeprom_demo/i2c_eeprom_demo.ino`) que usa
  `Wire.h` para hablar con el chip 24C01.
- Compilado con `arduino-cli compile --fqbn arduino:avr:uno`. Salida en
  `fixtures/i2c_eeprom_demo.hex` (11 KB, ATmega328P).
- Test `07_chip_eeprom_avr_e2e` pasa: el sketch escribe 4 bytes (0xAA..0xDD),
  resetea el pointer, lee de vuelta, y los emite por Serial. La suite verifica
  que los 4 bytes aparecen en `getSerialOutput()` en el orden correcto.

### Cadena verificada end-to-end

```
i2c_eeprom_demo.ino (C++)
  → arduino-cli + arduino:avr:1.8.7
    → ATmega328P .hex
      → avr8js CPU (real instrucciones)
        → AVRTWI peripheral (real I2C bit-banging)
          → I2CBus (TWIEventHandler)
            → ChipInstance (WASM)
              → eeprom-24c01.wasm
                → callbacks I2C (connect/read/write/stop)
                  → respuestas del bus
                    → AVR USART transmit
                      → serialOut buffer
                        → assertion en el test ✅
```

### API gap vs wokwi-api.h

Documentado en `06_wokwi_api_gap_analysis.md`. Lo importante que falta:
- SPI slave (alta prioridad)
- `OUTPUT_LOW`/`OUTPUT_HIGH` modes
- `pin_watch_stop`
- `reserved[8]` en configs (forward-compat)
- `pin_dac_write`, `pin_mode`

Total estimado: ~1 día para cubrir esos gaps.

---

## 2026-04-28 (sesión 2) — Suite completa: GPIO + I2C + UART + multi-chip + AVR

### Resultado

```
Test Files  19 passed | 1 skipped (20)
Tests       48 passed | 1 skipped (49)
```

### Chips compilados y validados

| Chip | Tamaño | Protocolos ejercitados |
|---|---|---|
| `inverter.wasm`       | 63 KB | GPIO + pin_watch |
| `xor.wasm`            | 63 KB | GPIO + pin_watch (2 inputs) |
| `cd4094.wasm`         | 64 KB | GPIO + pin_watch BOTH/RISING + state machine 8-bit |
| `eeprom-24c01.wasm`   | 64 KB | I2C slave + addressing + 128-byte memory |
| `eeprom-24lc256.wasm` | 64 KB | I2C slave + 16-bit addressing + 32 KB memory |
| `uart-rot13.wasm`     | 63 KB | UART RX/TX + struct passing + uart_write |

### Tests por categoría

**Tier 1 — single chip (10 tests):** inicialización, edges, truth table XOR, shift register
8-bit, power gate, strobe latching.

**Tier 2 — protocols (13 tests):**
- I2C 24C01: write/read básico, auto-increment, wrap @ 0x80, A0/A1/A2 pin selection.
- I2C 24LC256: 16-bit addressing, high addresses (>0xff), page write 8 bytes, cross-page read.
- UART ROT13: A↔N, Z↔M wrap, lowercase, non-alpha passthrough, round-trip todos los printables.

**Tier 3 — multi-chip (4 tests):**
- Dos 24C01 con A0 distinto → 0x50 y 0x51 independientes en el mismo bus.
- NACK a direcciones no usadas (0x52..0x77).
- Dos CD4094 cascadeados (A.QS → B.DATA) con CLK/STR compartidos.
- XOR.OUT → Inverter.IN → XNOR truth table (logic chaining).
- EEPROM I2C + UART chip operando en paralelo sin interferencia.

**Tier 4 — AVR + chips (3 tests):**
- avr8js con `blink.hex` real → pin 13 toggle → Inverter chip OUT toggle inverso.
- avr8js → XOR.A (B held LOW) → OUT mirrors A.
- avr8js → CD4094.CLK + DATA HIGH + strobe → register latches non-zero.

### Protocolos validados end-to-end

✅ **GPIO**: pin_register, pin_read, pin_write, pin_watch (RISING/FALLING/BOTH).
✅ **I2C slave**: connect/read/write/stop callbacks via function table indirect.
✅ **UART**: rx_byte callback, write_done callback, vx_uart_write con buffer.
✅ **Multi-instance**: dos `.wasm` idénticos con state independiente (memorias separadas).
✅ **Multi-chip**: chips de protocolos distintos en el mismo `PinManager` + `I2CBus`.
✅ **Chip → chip**: la salida de un chip dispara el `pin_watch` de otro chip.
✅ **AVR → chip**: el AVR drivea pines y los chips reaccionan correctamente.

### Lo que NO hicimos (todavía)

- Test #07 `chip_eeprom_avr_e2e` requiere `.hex` de un sketch con `Wire.h` hablando con
  el chip 24C01. Si bien todos los componentes están validados por separado, falta
  ese caso "AVR Wire master + chip I2C slave" como prueba final.

---

## 2026-04-28 — wasi-sdk + compilación real + E2E pasando

### Hito alcanzado: VIABILIDAD CONFIRMADA

**El sistema completo funciona end-to-end.** Un `.c` escrito contra `velxio-chip.h`
compila a `.wasm` con clang+wasi-sdk, se carga en el `ChipRuntime`, y la lógica
del chip (incluyendo I2C slave con callbacks via function table) ejecuta correctamente.

### Resultados

```
Test Files  6 passed | 1 skipped (7)
Tests      17 passed | 1 skipped (18)
```

- ✅ `inverter.c` compilado (~63 KB) — `vx_pin_register`/`vx_pin_write`/`vx_pin_watch`
  con callback indirect-call funcionan en WASM real.
- ✅ `eeprom-24c01.c` compilado (~63 KB) — protocolo I2C completo: addressing,
  write pointer + bytes, read sequential, pointer auto-increment.
- ✅ Dos instancias del mismo `.wasm` (24C01 con A0 distintos → direcciones
  0x50 y 0x51) operan en paralelo en el mismo `I2CBus` sin interferencia.
- ⏭ Skipped: test #07 que requiere un `.hex` de Arduino real con `Wire.h`
  hablándole al chip. Falta compilarlo con `arduino-cli`.

### Setup que funcionó

- **WASI-SDK 32.0** instalado en `C:\wasi-sdk` (Windows). Apache 2.0.
- **clang 22.1.0** con target `wasm32-unknown-wasip1`.
- Comando final:
  ```
  clang --target=wasm32-unknown-wasip1 -O2 -nostartfiles \
        -Wl,--import-memory -Wl,--export-table -Wl,--no-entry \
        -Wl,--export=chip_setup -Wl,--allow-undefined \
        -I sdk/include chip.c -o chip.wasm
  ```

### Lo que NO funcionó al primer intento

1. **Target deprecado**: `--target=wasm32-unknown-wasi` daba warning. Se cambió
   a `wasm32-unknown-wasip1`.
2. **Linker fallaba** con "undefined symbol: vx_pin_register …": faltaba
   `-Wl,--allow-undefined`. Sin ese flag, las funciones extern del header
   se trataban como link errors. Con el flag, el linker las convierte en
   imports WASM (que es exactamente lo que queremos).
3. **Doble prefijo `[chip] [chip] inverter ready`** en stdout: el `WasiShim`
   prefijaba el output de printf y el `ChipRuntime` también prefijaba en
   `vx_log`. Se removió el prefijo del runtime (lo deja al WasiShim).

### Tamaño del WASM

~63 KB tanto para inverter como para 24C01. Más de lo estimado (~10 KB)
porque wasi-libc trae `malloc`+`printf`+familia. Aceptable para el caso
de uso (almacenar por proyecto en SQLite).

### Próximos pasos

- Compilar un sketch Arduino real (`Wire.h`) con `arduino-cli` y dropearlo
  en `fixtures/i2c_eeprom_demo.hex` para activar el test #07. Eso valida
  el flujo completo: AVR sketch → I2C bus virtual → chip WASM → respuesta.
- Implementar `vx_uart_attach` (hoy stub).
- Validar el `_Static_assert(sizeof(vx_i2c_config) == 32)` realmente se
  honra: el header lo declara, pero confirmarlo en runtime con un script
  de compilación que falle si cambia.
- Decidir cómo reducir el tamaño del .wasm (¿compilar sin printf? ¿stripping
  agresivo?). No urgente.

---

## 2026-04-27 — Sesión inicial: scaffold + diseño

### Lo que se hizo

- Se creó la estructura `test/autosearch/` y `test/test_custom_chips/`.
- Se documentó la API de Wokwi como referencia (no como código a usar).
- Se diseñó `velxio-chip.h` desde cero, naming propio (`vx_*`).
- Se decidió: cero código de Wokwi en el proyecto. Toolchain solo LLVM/WASI.
- Se implementaron los siguientes módulos JS en el sandbox:
  - `src/PinManager.js` — espejo 1:1 de `frontend/src/simulation/PinManager.ts`.
  - `src/I2CBus.js` — espejo de `I2CBusManager.ts`.
  - `src/AVRHarness.js` — copiado desde `test_circuit/src/avr/AVRHarness.js` (mismo pattern que Velxio).
  - `src/ChipRuntime.js` — loader WASM + tabla de host imports.
  - `src/WasiShim.js` — `fd_write`, `proc_exit`, `clock_time_get`.

### Qué probamos

- Tests JS-only (no requieren clang) corren con `pnpm test`.
- Validan el shape de PinManager, I2CBus, host imports, AVRHarness con `.hex` real.

### Qué falta (próxima sesión)

- Compilar `inverter.c` y `eeprom-24c01.c` con `compile-chip.sh` para generar fixtures `.wasm`.
- Test E2E: AVR sketch + 24C01 chip vía I2C bus virtual. Validar lectura/escritura.
- Implementar `vx_pin_watch` con indirect call al function table.
- Decidir layout exacto del struct `vx_i2c_config` (ABI estable entre clang y host JS).

### Lo que NO funcionó (todavía)

- N/A — primera sesión.

### Lo que funcionó

- Reusar `AVRHarness.js` de `test_circuit` sin modificaciones — buena señal de que la
  abstracción está bien hecha en Velxio.
- `I2CBusManager` de Velxio ya tiene la interface que necesita el chip (`writeByte`/`readByte`/`stop`)
  → mapeo casi directo.
