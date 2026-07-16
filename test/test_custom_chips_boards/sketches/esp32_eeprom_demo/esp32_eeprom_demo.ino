/*
 * esp32_eeprom_demo.ino — ESP32 sketch that talks to a Velxio Custom Chip
 * 24C01-class EEPROM running in the backend QEMU worker.
 *
 * Sequence:
 *   1. Write 4 bytes (0xAA, 0xBB, 0xCC, 0xDD) starting at EEPROM address 0x10.
 *   2. Reset the pointer to 0x10.
 *   3. Read 4 bytes back and emit them by Serial as decimal values.
 *   4. Print READY before everything (test waits for this banner).
 *
 * The test asserts the four bytes appear in the order 170, 187, 204, 221.
 *
 * Default ESP32 I2C pins (esp32:esp32:esp32):
 *   SDA = GPIO21, SCL = GPIO22
 *
 * The Velxio chip is registered at I2C address 0x50 by the backend runtime.
 */
#include <Wire.h>

void setup() {
  Wire.begin();              // default pins SDA=21, SCL=22
  Serial.begin(115200);
  delay(200);
  Serial.println("READY");

  // ── 1. Write pointer + 4 data bytes ──
  Wire.beginTransmission(0x50);
  Wire.write((uint8_t)0x10);
  Wire.write((uint8_t)0xAA);
  Wire.write((uint8_t)0xBB);
  Wire.write((uint8_t)0xCC);
  Wire.write((uint8_t)0xDD);
  Wire.endTransmission();

  // ── 2. Reset pointer to 0x10 ──
  Wire.beginTransmission(0x50);
  Wire.write((uint8_t)0x10);
  Wire.endTransmission();

  // ── 3. Read 4 bytes back ──
  Wire.requestFrom((uint8_t)0x50, (uint8_t)4);
  while (Wire.available()) {
    int b = Wire.read();
    Serial.print("BYTE=");
    Serial.println(b);
  }
  Serial.println("DONE");
}

void loop() {}
