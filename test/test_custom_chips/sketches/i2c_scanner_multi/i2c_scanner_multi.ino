/*
 * i2c_scanner_multi.ino — Walks the entire 7-bit I2C address space
 * (1..126) and emits every responding address as a single byte over
 * Serial, terminated by 0xFF.  Used by the E2E test to verify:
 *
 *   - Multi-device coexistence on a single I2C bus.
 *   - Correct ACK/NACK behaviour: registered addresses ACK, every
 *     other address NACKs.
 *   - I2CBusManager's connect-then-stop transaction shape (the
 *     scanner sends a zero-byte transmission, just SLA+W followed
 *     by STOP — no data).
 */
#include <Wire.h>

void setup() {
  Wire.begin();
  Serial.begin(9600);
  // Settle: ensures Timer0 has rolled at least once so millis()
  // can sequence subsequent reads.
  delay(50);

  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    // endTransmission returns 0 when the slave ACKed the address.
    if (Wire.endTransmission() == 0) {
      Serial.write(addr);
    }
  }
  // Terminator so the test knows the scan completed.
  Serial.write((uint8_t)0xFF);
  Serial.flush();
}

void loop() {}
