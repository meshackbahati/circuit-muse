/*
 * rtc_lcd_clock.ino — Real-world demo: read time from a DS1307 RTC
 * (I2C 0x68) and display "HH:MM:SS" on a PCF8574-backed 16x2 LCD
 * (I2C 0x27).
 *
 * Exercises:
 *   - Two distinct I2C devices coexisting on the same bus.
 *   - Sequential master transactions: one write+read against the
 *     RTC, then ~30 writes against the LCD backpack.
 *   - BCD decoding round-trip (sketch → device returns BCD →
 *     sketch decodes → LCD displays ASCII).
 *
 * The VirtualDS1307 in I2CBusManager.ts returns the host's current
 * wall-clock time, so the E2E test only asserts the displayed
 * pattern matches /^\d{2}:\d{2}:\d{2}$/ — not a specific value.
 */
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

static char nibble2hex(uint8_t v) {
  return (v < 10) ? ('0' + v) : ('A' + v - 10);
}

void setup() {
  Wire.begin();
  lcd.init();
  lcd.backlight();

  // ── Read seconds, minutes, hours from DS1307 (registers 0..2) ──
  Wire.beginTransmission(0x68);
  Wire.write((uint8_t)0x00);  // point at seconds register
  Wire.endTransmission();
  Wire.requestFrom((uint8_t)0x68, (uint8_t)3);
  uint8_t s_bcd = Wire.read();
  uint8_t m_bcd = Wire.read();
  uint8_t h_bcd = Wire.read();

  // BCD nibbles → ASCII.  The DS1307 stores 0..59 (sec/min) in BCD
  // and 0..23 (hour, 24h mode) in BCD when bit 6 of the hour
  // register is 0.  VirtualDS1307 always emits 24h-mode BCD.
  uint8_t s_t = (s_bcd >> 4) & 0x7;
  uint8_t s_u = s_bcd & 0x0f;
  uint8_t m_t = (m_bcd >> 4) & 0x7;
  uint8_t m_u = m_bcd & 0x0f;
  uint8_t h_t = (h_bcd >> 4) & 0x3;
  uint8_t h_u = h_bcd & 0x0f;

  // ── Render to LCD ──
  lcd.setCursor(0, 0);
  lcd.print("Time:");
  lcd.setCursor(0, 1);
  lcd.write('0' + h_t);
  lcd.write('0' + h_u);
  lcd.write(':');
  lcd.write('0' + m_t);
  lcd.write('0' + m_u);
  lcd.write(':');
  lcd.write('0' + s_t);
  lcd.write('0' + s_u);

  // Avoid unused-warning on the helper if the compiler optimizes
  // aggressively.
  (void)nibble2hex;
}

void loop() {}
