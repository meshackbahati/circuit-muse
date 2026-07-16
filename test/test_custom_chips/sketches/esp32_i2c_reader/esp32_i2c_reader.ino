/*
 * esp32_i2c_reader.ino — ESP32 Wire master that READS bytes from a
 * peer board's I2C device.  Used to verify the cross-board proxy
 * path (ESP32 firmware → QEMU → backend ProxySlave → response).
 *
 * Reads 4 bytes from register 0 of the device at address 0x50, then
 * echoes them back over Serial as a deterministic marker the test
 * harness can pattern-match.  In the test setup, the peer board's
 * I2CMemoryDevice has registers[0..3] = {0xDE, 0xAD, 0xBE, 0xEF}
 * pre-loaded, and Interconnect installs a ProxySlave snapshot of
 * those bytes on the ESP32 side at bridge attach time.
 */
#include <Arduino.h>
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin();

  // Set the device's register pointer to 0.
  Wire.beginTransmission(0x50);
  Wire.write((uint8_t)0x00);
  Wire.endTransmission();

  // Read 4 bytes back.
  Wire.requestFrom((uint16_t)0x50, (uint8_t)4);
  for (int i = 0; i < 4; i++) {
    if (Wire.available()) {
      uint8_t b = (uint8_t)Wire.read();
      Serial.print("BYTE[");
      Serial.print(i);
      Serial.print("]=0x");
      if (b < 0x10) Serial.print('0');
      Serial.println(b, HEX);
    }
  }
  Serial.println("DONE");
}

void loop() {}
