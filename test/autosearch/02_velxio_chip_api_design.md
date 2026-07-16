# Velxio Chip API — diseño

> Header propio, naming propio. Cero dependencia de Wokwi a nivel código fuente o binario.

## Convenciones

- Prefijo: `vx_*` (lowercase, snake_case en C).
- Tipos opacos: `vx_pin`, `vx_attr`, `vx_timer`, `vx_i2c`, `vx_uart`, `vx_spi`. Todos son `int32_t`
  bajo el capot — opacos para el chip, índices o handles para el host.
- Constantes en MAYÚSCULAS con prefijo `VX_`.
- El chip exporta una sola función obligatoria: `chip_setup()`. Se llama una vez por instancia.

## Header completo (resumido)

Ver `test_custom_chips/sdk/include/velxio-chip.h` para el header con docstrings.

```c
// Pines
typedef int32_t vx_pin;
typedef enum { VX_INPUT, VX_OUTPUT, VX_INPUT_PULLUP, VX_INPUT_PULLDOWN, VX_ANALOG } vx_pin_mode;
typedef enum { VX_LOW = 0, VX_HIGH = 1 } vx_pin_value;
typedef enum { VX_EDGE_RISING, VX_EDGE_FALLING, VX_EDGE_BOTH } vx_edge;

vx_pin vx_pin_register(const char* name, vx_pin_mode mode);
int    vx_pin_read(vx_pin p);
void   vx_pin_write(vx_pin p, int value);
void   vx_pin_watch(vx_pin p, vx_edge edge,
                    void (*cb)(void* ud, vx_pin p, int value),
                    void* user_data);

// Atributos editables
typedef int32_t vx_attr;
vx_attr vx_attr_register(const char* name, double default_val);
double  vx_attr_read(vx_attr a);

// I2C slave
typedef int32_t vx_i2c;
typedef struct {
  uint8_t address;
  vx_pin scl, sda;
  bool    (*on_connect)(void* ud, uint8_t addr, bool is_read);
  uint8_t (*on_read)(void* ud);
  bool    (*on_write)(void* ud, uint8_t byte);
  void    (*on_stop)(void* ud);
  void* user_data;
} vx_i2c_config;
vx_i2c vx_i2c_attach(const vx_i2c_config* cfg);

// Tiempo + Timer
typedef int32_t vx_timer;
uint64_t vx_sim_now_nanos(void);
vx_timer vx_timer_create(void (*cb)(void* ud), void* user_data);
void     vx_timer_start(vx_timer t, uint64_t period_nanos, bool repeat);
void     vx_timer_stop(vx_timer t);

// Log
void vx_log(const char* msg);
```

## Mapeo a infraestructura existente de Velxio

| API velxio-chip | Implementación host | Reusa de |
|---|---|---|
| `vx_pin_register` | Registra nombre lógico → handle. La conexión real vía wires se resuelve al cablear | nada nuevo |
| `vx_pin_read` / `vx_pin_write` | Resuelve handle → wire → otro endpoint → PinManager | `PinManager.getPinState`, `triggerPinChange` |
| `vx_pin_watch` | Suscribe al PinManager y enruta evento al WASM vía `__indirect_function_table` | `PinManager.onPinChange` |
| `vx_attr_register` / `vx_attr_read` | Lee de `component.properties` (mapa user-editable) | `ComponentMetadata.properties` |
| `vx_i2c_attach` | Crea un `I2CDevice` con writeByte/readByte/stop que llaman al WASM, lo agrega al `I2CBusManager` | `I2CDevice` interface |
| `vx_timer_*` | Cola interna de timers tickeada cada frame de `cpu.tick()` | clock del simulador activo |
| `vx_sim_now_nanos` | `cpu.cycles / clockFreq * 1e9` o equivalente por simulador | `cpu.cycles` |
| `vx_log` | Concatena al buffer de "Chips Console" (panel UI nuevo) | nada por ahora |

## Decisiones tomadas

- **Lifecycle**: una sola función `chip_setup`. No hay `chip_loop` — los chips son reactivos
  (callbacks de pin/I2C/timer). Esto elimina el problema del scheduler entre el AVR y el chip.
- **`malloc` está OK**: viene en `wasi-libc`. Cada instancia del chip hace su `malloc(sizeof(state))`
  igual que en Wokwi.
- **String passing**: punteros `const char*` se pasan como i32 a la host function, que lee bytes
  hasta nul desde `instance.exports.memory.buffer`.
- **Struct passing**: para `vx_i2c_config` se pasa puntero. El host lee los offsets fijos del struct.
  ABI: `__attribute__((packed))` o documentación explícita del layout.
- **Function pointers**: el WASM es compilado con `--export-table`. El host invoca `instance.exports.__indirect_function_table.get(idx)(...args)`.
- **Memoria**: el host crea un `WebAssembly.Memory({initial: 2})` por instancia y la pasa como import.

## Pendiente de decidir

Ver `05_open_questions.md`.
