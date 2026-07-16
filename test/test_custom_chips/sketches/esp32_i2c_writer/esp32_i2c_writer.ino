/*
 * esp32_i2c_writer.ino — Minimal ESP32 I2C master that pokes one
 * write-only PCF8574-style backpack address at 0x27 with a known
 * pattern.  Used by the WebSocket+QEMU E2E test to confirm
 * Wire.h on ESP32 generates real i2c_transaction events that
 * arrive at the frontend bridge intact.
 */
#include <Arduino.h>
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin();

  // Send a clearly-recognisable byte pattern over I2C 0x27.
  // Repeat a few times so the test can deduplicate / wait reliably.
  for (int i = 0; i < 5; i++) {
    Wire.beginTransmission(0x27);
    Wire.write(0xAA);
    Wire.write(0x55);
    Wire.endTransmission();
    delay(30);
  }
  Serial.println("DONE");
}

void loop() {}
