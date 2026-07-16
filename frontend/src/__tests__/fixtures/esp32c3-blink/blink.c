/**
 * ESP32-C3 bare-metal LED blink — no ESP-IDF, no FreeRTOS.
 *
 * Targets RV32IMC directly. Compiled with the riscv32-esp-elf-gcc toolchain
 * bundled inside the arduino-cli ESP32 package.
 *
 * Memory map (matches Esp32C3Simulator):
 *   Flash (IROM)  @ 0x42000000  — code lands here
 *   DRAM          @ 0x3FC80000  — stack/data
 *   GPIO_W1TS     @ 0x60004008  — set pin high
 *   GPIO_W1TC     @ 0x6000400C  — set pin low
 *
 * LED: GPIO 8 (ESP32-C3-DevKit onboard LED)
 */

#define GPIO_W1TS  (*(volatile unsigned int *)0x60004008u)
#define GPIO_W1TC  (*(volatile unsigned int *)0x6000400Cu)

#define LED_PIN   8u
#define LED_BIT   (1u << LED_PIN)

/* Short delay — small enough for the test to run fast */
static void delay(int n) {
    for (volatile int i = 0; i < n; i++);
}

/* Entry point — the linker script places _start at 0x42000000 */
void _start(void) {
    while (1) {
        GPIO_W1TS = LED_BIT;   /* LED ON  — sets bit 8 of gpioOut */
        delay(50);
        GPIO_W1TC = LED_BIT;   /* LED OFF — clears bit 8 of gpioOut */
        delay(50);
    }
}
