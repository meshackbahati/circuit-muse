# Wokwi Custom Chips — investigación de referencia

> **Esto NO es código que copiemos.** Es una descripción del sistema de Wokwi para entender
> el dominio del problema antes de diseñar el nuestro propio.

Consultado: 2026-04-27.

## Qué es

Wokwi permite que el usuario escriba un chip en C, lo compile a WebAssembly, y lo
agregue a su diagrama. El chip simula su comportamiento eléctrico/lógico cuando el sketch
del Arduino interactúa con sus pines.

Fuentes:
- https://docs.wokwi.com/chips-api/getting-started
- https://docs.wokwi.com/chips-api/chip-json
- https://docs.wokwi.com/chips-api/i2c
- https://docs.wokwi.com/chips-api/uart
- https://docs.wokwi.com/chips-api/spi
- https://docs.wokwi.com/chips-api/tutorial-7seg
- https://github.com/alextrical/wokwi-24C01-custom-chip (ejemplo MIT real)

## Anatomía de un chip Wokwi

Dos archivos:

1. **`chip.c`** — incluye `wokwi-api.h`. Define una función `chip_init()` que se llama
   una vez por cada instancia del chip al iniciar el simulador.
2. **`chip.json`** — declara nombre, autor, lista de pines, atributos editables, opciones de display.

Ejemplo `chip.json` (24C01 EEPROM):
```json
{
  "version": 1,
  "name": "24C01",
  "author": "Alextrical",
  "license": "MIT",
  "pins": ["A0","A1","A2","GND","VCC","WP","SCL","SDA"]
}
```

## API observada (resumen)

### Pines
- `pin_t pin_init(const char* name, pin_mode mode)` — registra y devuelve handle.
- `uint32_t pin_read(pin_t)`, `void pin_write(pin_t, uint32_t)`.
- `void pin_watch(pin_t, const pin_watch_config_t*)` con callback en flanco.
- Modos: `INPUT`, `OUTPUT`, `OUTPUT_HIGH`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, `ANALOG`.
- Edges: `RISING`, `FALLING`, `BOTH`.

### I2C (slave)
- `i2c_dev_t i2c_init(const i2c_config_t* cfg)`. **Solo desde `chip_init()`**.
- Callbacks: `connect(ud, addr, isRead)→bool ack`, `read(ud)→uint8`, `write(ud, byte)→bool ack`, `disconnect(ud)`.
- Bus es 7-bit slave; el chip "responde" a una dirección.

### UART
- `uart_dev_t uart_init(const uart_config_t* cfg)`. RX/TX, baud, callbacks `rx_data` y `write_done`.
- `uart_write(uart, buffer, count)` para emitir bytes.

### SPI (slave)
- `spi_dev_t spi_init(const spi_config_t* cfg)`. Pines sck/mosi/miso, modo (0..3), callback `done`.
- `spi_start(spi, buffer, count)`, `spi_stop(spi)`.

### Atributos
- `attr_t attr_init(const char* name, uint32_t default_val)`, `attr_read(attr)`.
- Versiones `attr_init_float` / `attr_float_read` para reales.

### Tiempo
- `get_sim_nanos()` reloj de la simulación.
- API de timers: `timer_init`, `timer_start`, etc. (no la documentamos exhaustivamente acá).

### Misc
- `printf` funciona porque el chip se compila contra `wasi-libc` y la salida va a la "Chips Console".
- Estado por instancia: el chip hace `malloc(sizeof(chip_state_t))` en `chip_init()`.

## ABI del WASM

Compilación:
```
clang --target=wasm32-unknown-wasi -nostartfiles \
      -Wl,--import-memory -Wl,--export-table -Wl,--no-entry \
      -I<sdk> chip.c -o chip.wasm
```

- `--import-memory`: el host provee la memoria, el WASM la importa.
- `--export-table`: la tabla de funciones se exporta para que el host pueda invocar
  callbacks por índice (los punteros a función en C son índices en la tabla).
- `--no-entry`: no hay `main`, solo exports.

El WASM **importa** todas las funciones de la API (pin_init, i2c_init, etc) y **exporta**
`chip_init` + `memory` + `__indirect_function_table`.

## Conclusión para Velxio

Replicamos **el modelo** (chip = WASM con imports + exports), no el **API**. Velxio escribe
su propio header, sus propios nombres, su propio chip.json schema. El compilador (clang) y
runtime (wasi-libc) se mantienen idénticos porque son OSS no-Wokwi.
