# Decisiones pendientes

Cosas que vale la pena resolver explícitamente antes de mergear a master.

## ABI del struct `vx_i2c_config`

C struct layout depende del compilador. `clang --target=wasm32-unknown-wasi` con default
alignment usa:

- Pointers: 4 bytes
- `uint8_t`: 1 byte (con padding al siguiente alignment)
- `int32_t`: 4 bytes
- `bool`: 1 byte (en wasm32)

Layout esperado (en orden de declaración del header):

| Offset | Field | Bytes |
|---|---|---|
| 0 | `address` (uint8_t + 3 bytes padding) | 4 |
| 4 | `scl` (vx_pin = int32_t) | 4 |
| 8 | `sda` | 4 |
| 12 | `on_connect` (function pointer = i32) | 4 |
| 16 | `on_read` | 4 |
| 20 | `on_write` | 4 |
| 24 | `on_stop` | 4 |
| 28 | `user_data` (void*) | 4 |
| **32** | **total** | |

→ **Acción**: documentar este layout en el header con `_Static_assert(offsetof(...))`.

## ¿Cómo carga un chip su `chip.json` en runtime?

El `chip.json` describe pines y atributos. Pero el host ya tiene esa info al instanciar el chip
(la lee al cargar el chip). Cuando el chip llama `vx_pin_register("SDA", VX_INPUT)`, ¿el host:

a) Confía en lo que dice el WASM y crea el pin sobre la marcha?
b) Verifica que "SDA" existe en el `chip.json` y rechaza si no?

→ Propuesta: (a) en MVP, (b) como warning en consola más adelante.

## Manejo de tiempo

Cada simulador tiene su clock:
- AVR: `cpu.cycles` a 16 MHz
- RP2040: ciclos a 133 MHz
- ESP32 (QEMU): tiempo real wall clock

`vx_sim_now_nanos` debe ser:

→ Propuesta: anclar al CPU del board al que está conectado el chip vía wire. Si está conectado a un
   AVR, usar `cpu.cycles / 16e6 * 1e9`. Si a un RP2040, su contador. Si a múltiples boards,
   tomar el primer board encontrado (caso raro).

## Múltiples instancias del mismo chip

Si el usuario pone dos 24C01 con direcciones I2C distintas, ¿cómo se distinguen?

- Cada instancia tiene su `WebAssembly.Instance` propia. Aislamiento de memoria perfecto.
- Cada `chip_setup()` crea su propio `chip_state_t` con `malloc`.
- Pero **dos instancias del mismo `.wasm`** comparten el módulo compilado (cache).

→ Acción: validar con un test E2E que dos 24C01 con direcciones 0x50 y 0x51 funcionan en paralelo.

## printf y la "Chips Console"

`printf` desde el chip va a `fd_write` (WASI). El stub lo captura y por ahora va al stderr de Node.

→ Pendiente: decidir si en producción Velxio agrega un panel "Chips Console" separado del Serial Monitor,
   o si lo intercala con un prefijo `[chip-name]:`.

## Compilación: backend o browser

Implementación del MVP: backend Docker con wasi-sdk + endpoint REST.
Alternativa futura: clang en browser (vía `clang-wasm`) para modo offline puro.

→ Decisión actual: backend. Reevaluar tamaño del bundle browser cuando esté el MVP corriendo.

## Dimensión de la memoria del WASM

`WebAssembly.Memory({ initial: 2 })` = 128 KB. Suficiente para 99% de chips.
Algunos con buffers grandes (frame buffers) pueden necesitar más.

→ Acción: hacer configurable. Default 2 páginas, máximo 16 (1 MB).
