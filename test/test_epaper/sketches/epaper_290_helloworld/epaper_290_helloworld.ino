/*
 * epaper_290_helloworld — 2.9" 296×128 SSD1680 panel.
 * Compiles for AVR (paged) / RP2040 / ESP32. AVR Uno is borderline — if
 * Adafruit_GFX + GxEPD2 push the binary over 32 KB on your toolchain,
 * switch the page_height template parameter from 16 to 8.
 */

#include <Arduino.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>

#if defined(ARDUINO_ARCH_ESP32)
  #define EPD_CS    5
  #define EPD_DC    17
  #define EPD_RST   16
  #define EPD_BUSY  4
#elif defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_MBED_RP2040)
  #define EPD_CS    9
  #define EPD_DC    8
  #define EPD_RST   12
  #define EPD_BUSY  13
#else
  #define EPD_CS    10
  #define EPD_DC    9
  #define EPD_RST   8
  #define EPD_BUSY  7
#endif

GxEPD2_BW<GxEPD2_290_T94, 16> display(GxEPD2_290_T94(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("ePaper 2.9\" hello-world"));

  display.init(115200, true, 50, false);
  display.setRotation(1);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold9pt7b);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(30, 40);
    display.print(F("Velxio"));
    display.setCursor(30, 80);
    display.print(F("2.9\" e-Paper"));
  } while (display.nextPage());

  display.hibernate();
  Serial.println(F("Frame written; controller in deep sleep."));
}

void loop() { delay(1000); }
