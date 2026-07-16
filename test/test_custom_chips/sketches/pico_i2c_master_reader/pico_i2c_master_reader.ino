/*
 * pico_i2c_master_reader.ino — Pi Pico variant of the BMP280 reader.
 *
 * The Pico is wired (via the cross-board I2C bridge) to a peer
 * board that owns the BMP280 at I2C 0x76.  The Pico's master TWI
 * sends:
 *   1. chip_id register read   → expect 0x58
 *   2. status register read    → expect 0x00
 *
 * Both bytes are emitted via Serial1 (UART0 = USB CDC on the Pico
 * isn't reachable from rp2040js's onSerialData, but UART0 is).
 *
 * This proves the bridge works when the MASTER side is a real
 * compiled RP2040 binary running on rp2040js, not an AVR sketch.
 */
#include <Wire.h>

void setup() {
  Wire.begin();
  Serial1.begin(9600);
  delay(100);

  // chip_id (0xD0)
  Wire.beginTransmission(0x76);
  Wire.write((uint8_t)0xD0);
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)0x76, (uint8_t)1);
  if (Wire.available()) Serial1.write((uint8_t)Wire.read());

  // status (0xF3)
  Wire.beginTransmission(0x76);
  Wire.write((uint8_t)0xF3);
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)0x76, (uint8_t)1);
  if (Wire.available()) Serial1.write((uint8_t)Wire.read());

  Serial1.flush();
}

void loop() {}
