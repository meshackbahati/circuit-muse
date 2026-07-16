# 02 — ESP32-P4 chip overview

## Procesador

- **HP core**: dual-core RISC-V hasta **400 MHz** (RV32IMAFC + extensiones AI propietarias de Espressif).
- **LP core**: RISC-V single-core hasta **40 MHz** (low-power, similar al ULP coprocessor de otros ESP32).
- ABI: `ilp32f` (single-precision FPU) — confirmado por `file blink.ino.elf` → "RVC, single-float ABI".
- ISA real observada en el ELF: **RV32IMC** (compressed) + soft-float a nivel de Arduino core (el FPU está pero arduino-esp32 aún no lo usa universalmente).

## Memoria

- **768 KB SRAM HP** on-chip (utilizable como cache cuando hay PSRAM).
- **8 KB TCM RAM** zero-wait.
- Soporta **PSRAM externa hasta 32 MB**.
- Flash externa SPI (típicamente QSPI, hasta 16/32 MB en dev kits).

## Sin radio integrado

⚠️ **El P4 NO tiene Wi-Fi ni Bluetooth nativos**. Los dev kits (FireBeetle 2 ESP32-P4, ESP32-P4-Module, ESP32-P4-NANO) llevan un **ESP32-C6 externo** conectado por SDIO/UART para Wi-Fi 6 y BLE.

Implicación para emulación: el modelo NIC `esp32_wifi` / `esp32c3_wifi` que usa el `esp_qemu_manager` actual **no aplica directamente**. Habría que:
- (a) emular el bus SDIO/UART hacia un C6 emulado (complejo, no existe),
- (b) interceptar la API de IDF/Arduino (`WiFi.begin()`, etc.) y devolver mocks (ya hay un patrón parecido en `wifi_status_parser.py`).

## Periféricos relevantes para Velxio

| Periférico | Cantidad | Uso típico Velxio |
|---|---|---|
| GPIO | 55 (vs 22 en ESP32) | LED, botón, sensor digital |
| ADC | 7 ch × 2 unidades, 12-bit | sensores analógicos, potenciómetro |
| I²C | 2 master / 1 slave | sensores BMP280, MPU6050, LCD I²C |
| SPI | 3 (uno dedicado a flash/PSRAM) | display TFT, SD card |
| I²S | 3 | audio |
| UART | 5 | serial monitor + comms externos |
| LEDC PWM | 8 ch | LED brillo, servos |
| MCPWM | 2 | motor control |
| RMT | 4 ch | NeoPixel, IR |
| USB OTG 2.0 HS | 1 | host/device, **480 Mbps** |
| Ethernet | 1 (RMII) | Ethernet en dev kits |
| SDIO Host | 1 (3.0) | SD card / Wi-Fi co-proc |
| **MIPI-CSI** | 1 (1080p) | cámara — **no emulable** |
| **MIPI-DSI** | 1 (1080p) | display — **no emulable hoy** |

## Variantes de board en arduino-cli (verificadas)

```
esp32:esp32:esp32p4                       # ESP32P4 Dev Module (genérico)
esp32:esp32:esp32p4_core_board            # ESP32P4 Core Board
esp32:esp32:dfrobot_firebeetle2_esp32p4   # DFRobot FireBeetle 2 ESP32-P4
esp32:esp32:esp32p4_4ds_mipi              # 4D Systems ESP32-P4 MIPI Displays
esp32:esp32:esp32p4_4ds_mipi_round        # 4D Systems redondo
```

Para Velxio, el FQBN canónico debería ser `esp32:esp32:esp32p4` (Dev Module) — paralelo a `esp32:esp32:esp32` para el clásico.

## Comparativa con boards ya soportados en Velxio

| Board | Arch | Dónde corre hoy |
|---|---|---|
| Arduino Uno (atmega328p) | AVR 8-bit | frontend (avr8js) |
| ATtiny85 | AVR 8-bit | frontend (avr8js) |
| Raspberry Pi Pico (RP2040) | ARM Cortex-M0+ dual | frontend (rp2040js) |
| ESP32 | Xtensa LX6 dual | backend QEMU xtensa |
| ESP32-S3 | Xtensa LX7 dual | backend QEMU xtensa |
| ESP32-C3 | RISC-V RV32IMC single | backend QEMU riscv32 |
| Raspberry Pi 3B | ARM64 | backend QEMU aarch64 |
| **ESP32-P4** | **RISC-V RV32IMAFC dual + LP** | **backend QEMU riscv32 (cuando exista)** |

El ESP32-P4 cae en la **misma categoría que el ESP32-C3**: backend, `qemu-system-riscv32`, `-M esp32p4`. Reutiliza casi toda la plomería del C3 (UART por TCP, GPIO chardev, NIC slirp si llega Wi-Fi).
