/*
 * bmp280_bridge_reader.ino — Read the BMP280 chip_id register (0xD0,
 * expected value 0x58) and the status register (0xF3, expected 0x00)
 * from I2C address 0x76, then emit both bytes via Serial.
 *
 * Designed for the multi-board bridge test: the BMP280 lives on a
 * PEER board's I2C bus, the Uno is wired to it via SDA+SCL.  The
 * Uno never has a local 0x76 device — the transactions only succeed
 * if the cross-board bridge is functioning end-to-end through the
 * real avr8js AVRTWI peripheral.
 */
#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(9600);
  delay(50);

  // chip_id (0xD0)
  Wire.beginTransmission(0x76);
  Wire.write((uint8_t)0xD0);
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)0x76, (uint8_t)1);
  if (Wire.available()) Serial.write((uint8_t)Wire.read());

  // status (0xF3)
  Wire.beginTransmission(0x76);
  Wire.write((uint8_t)0xF3);
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)0x76, (uint8_t)1);
  if (Wire.available()) Serial.write((uint8_t)Wire.read());

  Serial.flush();
}

void loop() {}
