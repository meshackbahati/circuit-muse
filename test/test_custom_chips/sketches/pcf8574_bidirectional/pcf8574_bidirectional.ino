/*
 * pcf8574_bidirectional.ino — Exercise BOTH directions of the PCF8574
 * I/O expander on a single bus / single device:
 *
 *   1. Write 0xAA to the PCF8574 (sets the output latch — lower 4
 *      "0" bits drive their pins LOW, upper 4 "1" bits release them
 *      to Hi-Z / external pull-up).
 *   2. Read one byte back.  In open-drain mode the visible byte =
 *      portState (external pull-ups) AND outputLatch.  With default
 *      portState = 0xFF the result should equal 0xAA.
 *   3. Write 0x55 (inverse pattern), read again, expect 0x55.
 *   4. Write 0xFF (release everything), read again, expect 0xFF.
 *
 * The 3 read-back bytes are emitted over Serial so the E2E test
 * can assert the exact sequence.
 *
 * Verifies:
 *   - Master write + master read on the SAME device + SAME bus
 *     (round-trip stress of I2CBusManager.connectToSlave with
 *     write=true, then write=false, then back to write=true).
 *   - VirtualPCF8574's open-drain readByte() returning the
 *     correct AND of portState and outputLatch.
 */
#include <Wire.h>

static uint8_t writeThenRead(uint8_t value) {
  Wire.beginTransmission(0x27);
  Wire.write(value);
  Wire.endTransmission();

  Wire.requestFrom((uint8_t)0x27, (uint8_t)1);
  while (!Wire.available()) {}
  return Wire.read();
}

void setup() {
  Wire.begin();
  Serial.begin(9600);
  delay(50);

  uint8_t a = writeThenRead(0xAA);
  uint8_t b = writeThenRead(0x55);
  uint8_t c = writeThenRead(0xFF);

  Serial.write(a);
  Serial.write(b);
  Serial.write(c);
  Serial.flush();
}

void loop() {}
