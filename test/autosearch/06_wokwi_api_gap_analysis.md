# Gap analysis: velxio-chip.h vs wokwi-api.h

> Comparación de superficie de API. **No copiamos código** — solo identificamos qué
> features útiles del modelo de Wokwi todavía no implementamos para que el sandbox
> cubra los mismos casos de uso.

Fecha: 2026-04-28.

## Resumen

Implementadas: GPIO básico, attr (numérico), I2C slave, UART, timer, log.

Faltantes a considerar (en orden de prioridad):

| Prioridad | Feature | Estado | Notas |
|---|---|---|---|
| 🔴 Alta | **SPI slave** (`spi_init`, `spi_start`, `spi_stop`) | No tenemos | Protocolo de uso muy común |
| 🔴 Alta | **`OUTPUT_LOW` / `OUTPUT_HIGH` modes** | No tenemos | Inicializar pin output con valor inicial sin race |
| 🟡 Media | **`pin_watch_stop`** | No tenemos | Remover una suscripción |
| 🟡 Media | **`pin_dac_write`** | No tenemos | Salida analógica (DAC) |
| 🟡 Media | **`pin_mode`** | No tenemos | Cambiar modo después de init |
| 🟢 Baja | **String attributes** | No tenemos | Atributos texto / select |
| 🟢 Baja | **`attr_init_float` separado** | Cubierto | Nuestro `vx_attr_*` usa double — funciona |
| 🟢 Baja | **Framebuffer** (displays custom) | No tenemos | LCDs raros |
| 🟢 Baja | **`reserved[8]` en configs** | No tenemos | Forward-compat — añadir cuando publiquemos v1 |
| ⚪ N/A | Experimental `_mcu_*` | Skip | Acceso a memoria del CPU emulado, no esencial |

## Detalle por categoría

### GPIO

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `pin_init(name, mode) → pin_t` | `vx_pin_register(name, mode) → vx_pin` | ✅ |
| `pin_read(pin) → uint32` | `vx_pin_read(pin) → int` | ✅ |
| `pin_write(pin, value)` | `vx_pin_write(pin, value)` | ✅ |
| `pin_watch(pin, &config)` con struct | `vx_pin_watch(pin, edge, cb, ud)` (args directos) | ✅ (mejor) |
| `pin_watch_stop(pin)` | — | ❌ Falta |
| `pin_mode(pin, value)` | — | ❌ Falta |
| `pin_adc_read(pin) → float` | `vx_pin_read_analog(pin) → double` | ✅ |
| `pin_dac_write(pin, voltage) → float` | — | ❌ Falta |
| Modos: `INPUT/OUTPUT/INPUT_PULLUP/INPUT_PULLDOWN/ANALOG` | Tenemos los 5 | ✅ |
| Modos extra: `OUTPUT_LOW = 16`, `OUTPUT_HIGH = 17` | — | ❌ Falta |

**Ejemplo concreto donde importa**: el `inverter.c` llama `vx_pin_register("OUT", VX_OUTPUT)` y
luego inmediatamente `vx_pin_write(out, ...)` para poner el valor inicial. Hay una pequeña ventana
donde el pin queda en LOW antes de la primera escritura. `OUTPUT_HIGH` evitaría esa ventana
inicializando con HIGH desde el init.

### Atributos

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `attr_init(name, default_uint32) → uint32` | `vx_attr_register(name, default_double) → vx_attr` | ✅ (cambio de tipo) |
| `attr_read(attr) → uint32` | `vx_attr_read(attr) → double` | ✅ |
| `attr_init_float / attr_read_float` | (cubierto por double) | ✅ funcional |
| `attr_string_init / string_get_length / string_read` | — | ❌ Falta (caso raro) |

### I2C

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `i2c_init(&config) → i2c_dev_t` | `vx_i2c_attach(&cfg) → vx_i2c` | ✅ |
| Callbacks `connect/read/write/disconnect` | Mismos (con renombre `disconnect → on_stop`) | ✅ |
| `reserved[8]` en config | — | ⚠️ Falta (forward-compat) |

### UART

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `uart_init(&config) → uart_dev_t` | `vx_uart_attach(&cfg) → vx_uart` | ✅ |
| `uart_write(uart, buffer, count) → bool` | `vx_uart_write(uart, buffer, count) → bool` | ✅ |
| Callbacks `rx_data / write_done` | Mismos (renombre `rx_data → on_rx_byte`) | ✅ |

### SPI

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `spi_init(&config) → spi_dev_t` | — | ❌ Falta |
| `spi_start(spi, buffer, count)` | — | ❌ Falta |
| `spi_stop(spi)` | — | ❌ Falta |

**Implementación**: requiere agregar un `SPIBus` similar al `I2CBus` (con avr8js
no hay un `AVRSPI` directo igual de limpio que `AVRTWI`, pero hay `AVRSPI` en el
paquete avr8js — habría que envolverlo). Es trabajo de medio día.

### Timers

| wokwi-api.h | velxio-chip.h | Estado |
|---|---|---|
| `timer_init(&config) → timer_t` | `vx_timer_create(cb, ud) → vx_timer` | ✅ |
| `timer_start(timer, micros, repeat)` | `vx_timer_start(timer, nanos, repeat)` | ✅ (pero µs vs ns) |
| `timer_start_ns(timer, nanos, repeat)` | `vx_timer_start` ya en nanos | ✅ |
| `timer_stop(timer)` | `vx_timer_stop(timer)` | ✅ |
| `get_sim_nanos() → uint64` | `vx_sim_now_nanos() → uint64` | ✅ |

### Framebuffer (displays)

Todo el bloque `framebuffer_init / buffer_read / buffer_write` no lo tenemos.
Se necesita cuando un chip representa un display custom (LCDs, OLEDs raros).
**Decisión**: dejarlo para v2. El simulador de Velxio ya tiene `wokwi-elements`
para los displays comunes (SSD1306, ILI9341).

### Experimental MCU access

`_mcu_read_memory`, `_mcu_read_pc`, `_mcu_monitor_sp` — permite a un chip
inspeccionar el estado del CPU emulado. Útil para chips de debug pero no
para operación normal. **Skip**.

## Acciones recomendadas

1. **Agregar SPI al header y al runtime** — el caso de uso más común que falta.
   Hay chips populares (display drivers, ADCs externos, módulos LoRa) que solo
   hablan SPI.
2. **Agregar `OUTPUT_LOW` / `OUTPUT_HIGH`** — un enum extra y unas líneas en
   `_pin_register` para inicializar el state. Trivial.
3. **Agregar `vx_pin_watch_stop`** — devolver un handle desde `vx_pin_watch`
   y permitir cancelarlo. ~10 líneas.
4. **Agregar `reserved[8]` a los configs** — para que el ABI sea estable cuando
   añadamos campos en el futuro sin romper chips ya compilados. Cambio binario,
   hay que hacerlo antes de v1.
5. **`pin_dac_write`** y **`pin_mode`** — bajo riesgo, agregar cuando aparezca
   el primer chip que los necesite.
6. **Strings y framebuffer** — postponer.

Esos cambios todos juntos son ~1 día de trabajo + sus respectivos tests.
