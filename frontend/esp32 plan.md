Por qué no existe un avr8js para ESP32?

  El problema de la arquitectura Xtensa

  avr8js funciona porque AVR es una arquitectura abierta, simple y bien documentada (instrucciones de 16-bit, ~130
  opcodes, spec pública). Se implementó en ~3.500 líneas de TypeScript.

  La arquitectura Xtensa LX6/LX7 (ESP32/S3) es radicalmente diferente:

  - Propiedad de Cadence Design Systems — no hay especificación pública completa
  - VLIW configurable — instrucciones de 16, 24 o 32 bits mezcladas
  - ISA personalizable — cada vendor puede añadir extensiones (Espressif tiene la suya)
  - Cadence vende el simulador oficial (xt-run) por miles de dólares/año

  Implementar un emulador Xtensa open-source limpio legalmente es extremadamente difícil. Por eso no existe un
  paquete npm equivalente a avr8js.

  ---
  Lo que sí existe

  1. El propio Wokwi — propietario y cerrado

  El Wokwi real (que este proyecto clona) sí tiene un emulador ESP32 en WASM, pero es 100% propietario y cerrado. Su
   fundador Uri Shaked publicó avr8js como open source, pero el emulador Xtensa nunca lo hizo. Es el núcleo
  comercial de su negocio.

  2. ESP32-C3: sí hay camino en JS (RISC-V)

  El ESP32-C3 usa RISC-V rv32imc — arquitectura completamente abierta. Existen emuladores RISC-V en JS/WASM:

  ┌────────────────────────────────────────┬─────────────────────────┬──────────────────────┐
  │                Proyecto                │          Tipo           │        Estado        │
  ├────────────────────────────────────────┼─────────────────────────┼──────────────────────┤
  │ https://github.com/cnlohr/mini-rv32ima │ C, compilable a WASM    │ Activo, ~1000 líneas │
  ├────────────────────────────────────────┼─────────────────────────┼──────────────────────┤
  │ https://github.com/cnlohr/espwebc3     │ In-browser IDE ESP32-C3 │ Experimental         │
  ├────────────────────────────────────────┼─────────────────────────┼──────────────────────┤
  │ RISC-V en Wokwi                        │ Propietario             │ Sí funciona          │
  └────────────────────────────────────────┴─────────────────────────┴──────────────────────┘

  3. HackCable — el más cercano a lo que buscas

  https://github.com/ClementGre/HackCable — TypeScript + Webpack, usa avr8js para Arduino y tiene soporte ESP32
  parcial. Pero está abandonado y el ESP32 no tiene emulación real de CPU.

  4. esp32-machine-emulator — Python, no JS

  https://github.com/tflander/esp32-machine-emulator — emula GPIO/UART de MicroPython sobre ESP32, pero en Python
  puro. No sirve para firmware Arduino compilado.

  ---
  Resumen realista de opciones

  ESP32 (Xtensa LX6) en JS/WASM:
    ├── Open source: NO EXISTE
    ├── Propietario: Wokwi (cerrado)
    └── Posible hacerlo: MUY difícil (ISA propietaria)

  ESP32-C3 (RISC-V rv32imc) en JS/WASM:
    ├── mini-rv32ima compilado a WASM: POSIBLE
    ├── Periféricos (GPIO, UART): habría que implementarlos
    └── Esfuerzo: mediano (similar a rp2040js pero para C3)

  Vía QEMU (lcgamboa) con bridge Python↔WS:
    ├── ESP32 + C3: VIABLE
    ├── GPIO real: SÍ (con callbacks)
    └── Arquitectura: nativa servidor, no browser

  ---
  Recomendación práctica para este proyecto

  La única ruta open-source viable que da emulación ESP32 real con GPIO en el browser hoy es compilar QEMU (lcgamboa
   fork) a WASM. Emscripten puede compilar QEMU a WASM — de hecho es lo que hace Wokwi internamente para algunos
  targets. El repositorio https://github.com/copy/v86 demuestra que QEMU→WASM es factible. Pero es un proyecto de
  meses.

  Para el corto plazo, la integración más pragmática sigue siendo lcgamboa como proceso servidor + WebSocket bridge
  descrita antes.

  ---
  Sources:
  - https://github.com/wokwi/avr8js
  - https://github.com/ClementGre/HackCable
  - https://github.com/cnlohr/espwebc3
  - https://github.com/cnlohr/mini-rv32ima
  - https://github.com/tflander/esp32-machine-emulator
  - https://github.com/fcambus/jsemu
  - https://docs.wokwi.com/guides/esp32
