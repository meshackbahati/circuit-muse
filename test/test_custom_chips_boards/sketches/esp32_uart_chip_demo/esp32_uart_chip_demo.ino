/*
 * esp32_uart_chip_demo.ino — ESP32 sketch that pairs with a Velxio Custom Chip
 * UART loopback (e.g., ROT13). Tests the UART round-trip in the backend WASM
 * runtime: firmware writes → chip's on_rx_byte → chip's vx_uart_write →
 * firmware's Serial.read() returns transformed byte.
 *
 * Sequence:
 *   1. Print "READY".
 *   2. Send the literal string "Hello" (5 bytes) via Serial.write.
 *   3. In loop: every byte the firmware reads via Serial.read is printed as
 *      "RX=<decimal>". The chip ROT13s each one, so we expect:
 *        H (72) → U (85)
 *        e (101) → r (114)
 *        l (108) → y (121)
 *        l (108) → y (121)
 *        o (111) → b (98)
 *
 * The test asserts the five RX= lines appear in order.
 */
#include <Arduino.h>

const char* MESSAGE = "Hello";
bool sent = false;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("READY");
}

void loop() {
  if (!sent) {
    delay(100);    // give the chip's runtime a moment to settle
    Serial.write((const uint8_t*)MESSAGE, 5);
    sent = true;
  }
  while (Serial.available()) {
    int b = Serial.read();
    Serial.print("RX=");
    Serial.println(b);
  }
}
