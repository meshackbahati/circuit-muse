/*
 * esp32_i2c_write_to_peer.ino — ESP32 Wire master that WRITES a byte
 * sequence to address 0x27.  Used to verify the proxy_i2c_complete
 * write-forwarding path: when the ESP32 firmware writes through QEMU's
 * I2C peripheral, the backend ProxySlave should buffer the bytes and
 * emit them to the frontend on STOP, where the peer device's
 * writeByte() gets called.
 */
#include <Arduino.h>
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin();
  Wire.beginTransmission(0x27);
  Wire.write((uint8_t)0xAA);
  Wire.endTransmission();
  Serial.println("DONE");
}
void loop() {}
