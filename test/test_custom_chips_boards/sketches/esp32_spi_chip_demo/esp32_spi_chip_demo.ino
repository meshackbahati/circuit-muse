/*
 * esp32_spi_chip_demo.ino — ESP32 sketch that pairs with a Velxio Custom Chip
 * 74HC595 SPI shift register running in the backend.
 *
 * Wiring (the test harness's pin_map sets these GPIOs):
 *   SER   = GPIO23 (default ESP32 VSPI MOSI)
 *   SRCLK = GPIO18 (default ESP32 VSPI SCK)
 *   RCLK  = GPIO5  (latch, GPIO output from sketch)
 *   SRCLR = GPIO22 (held HIGH = no clear)
 *   OE    = GPIO21 (held LOW = outputs enabled — the chip ignores this in MVP)
 *   QH    = GPIO19 (cascade out — unused)
 *   Q0..Q7 = GPIOs 13, 14, 15, 16, 17, 25, 26, 27 (chip drives, sketch reads)
 *
 * Test sequence:
 *   1. Print "READY".
 *   2. Pull SRCLR HIGH (no clear).
 *   3. SPI.transfer(0xA5) — chip stores it in its shift_reg.
 *   4. Pulse RCLK rising edge — chip latches shift_reg → Q0..Q7 (LSB-first).
 *   5. Read the 8 GPIOs Q0..Q7 and print "Q=" + 8-bit pattern.
 *
 * Expected output: "Q=10100101" (because 0xA5 LSB-first → Q0=1,Q1=0,Q2=1,
 * Q3=0,Q4=0,Q5=1,Q6=0,Q7=1).
 */
#include <Arduino.h>
#include <SPI.h>

const int CS_RCLK = 5;
const int SRCLR   = 22;
const int OE      = 21;
const int Q_PINS[8] = { 13, 14, 15, 16, 17, 25, 26, 27 };

void setup() {
  Serial.begin(115200);
  pinMode(CS_RCLK, OUTPUT);
  pinMode(SRCLR,   OUTPUT);
  pinMode(OE,      OUTPUT);
  digitalWrite(CS_RCLK, LOW);
  digitalWrite(SRCLR,   HIGH);
  digitalWrite(OE,      LOW);
  for (int i = 0; i < 8; i++) pinMode(Q_PINS[i], INPUT);

  delay(300);
  Serial.println("READY");

  // 1. Send the byte over SPI.
  SPI.begin();
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(0xA5);
  SPI.endTransaction();

  // 2. Pulse RCLK (rising edge → chip latches shift_reg to outputs).
  delay(10);
  digitalWrite(CS_RCLK, HIGH);
  delay(5);
  digitalWrite(CS_RCLK, LOW);

  // 3. Give the chip a moment, then read the 8 outputs.
  delay(20);
  Serial.print("Q=");
  for (int i = 0; i < 8; i++) {
    Serial.print(digitalRead(Q_PINS[i]));
  }
  Serial.println();
}

void loop() {}
