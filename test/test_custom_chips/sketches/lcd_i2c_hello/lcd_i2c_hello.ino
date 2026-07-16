/*
 * lcd_i2c_hello.ino — Arduino sketch that drives an HD44780 16x2 LCD
 * over an I2C backpack (PCF8574 @ 0x27).  Used as a real-firmware
 * E2E fixture for velxio's lcd1602-i2c part.
 *
 * Sequence:
 *   1. lcd.init()        - LiquidCrystal_I2C init sequence (4-bit init,
 *                          function set, display off, clear, entry mode).
 *   2. lcd.backlight()   - Turn on backlight (BL bit set high in subsequent
 *                          writes).
 *   3. lcd.setCursor(0, 0); lcd.print("Hello"); - row 0, col 0, 5 chars.
 *   4. lcd.setCursor(0, 1); lcd.print("World"); - row 1, col 0, 5 chars.
 *
 * The expected DDRAM state afterwards is:
 *   row 0: H e l l o
 *   row 1: W o r l d
 *
 * The test reads the HD44780 decoder snapshot (or the wokwi-lcd1602
 * `characters` array if wired through the lcd1602-i2c part) and
 * checks those positions.
 */
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello");
  lcd.setCursor(0, 1);
  lcd.print("World");
}

void loop() {}
