/*
 * i2c_eeprom_demo.ino — Arduino Wire master that talks to a 24C01-class EEPROM
 * (the velxio custom chip eeprom-24c01.wasm).
 *
 * Sequence:
 *   1. Set EEPROM pointer to 0x00, write bytes 0xAA, 0xBB, 0xCC, 0xDD.
 *   2. Reset pointer to 0x00.
 *   3. Read 4 bytes back and emit them on Serial.
 *
 * The test harness asserts that the four expected bytes appear in the AVR's
 * USART output stream.
 */
#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(9600);
  delay(50); // small settle so the chip's vx_log doesn't race with us

  // 1. Write the address pointer + 4 data bytes.
  Wire.beginTransmission(0x50);
  Wire.write((uint8_t)0x00);
  Wire.write((uint8_t)0xAA);
  Wire.write((uint8_t)0xBB);
  Wire.write((uint8_t)0xCC);
  Wire.write((uint8_t)0xDD);
  Wire.endTransmission();

  // 2. Reset pointer to 0.
  Wire.beginTransmission(0x50);
  Wire.write((uint8_t)0x00);
  Wire.endTransmission();

  // 3. Read 4 bytes and echo them via Serial.
  Wire.requestFrom((uint8_t)0x50, (uint8_t)4);
  while (Wire.available()) {
    Serial.write((uint8_t)Wire.read());
  }
  Serial.flush();
}

void loop() {}
