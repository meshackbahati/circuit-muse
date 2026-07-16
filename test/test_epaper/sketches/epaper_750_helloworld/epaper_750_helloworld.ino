/*
 * epaper_750_helloworld — 7.5" 800×480 UC8179 / GD7965 panel.
 *
 * Definitely too big for AVR (and tight on RAM for ESP32 if you
 * full-buffer it). Use ESP32 family with paged mode.
 */

#include <Arduino.h>

#if defined(ARDUINO_ARCH_AVR)
  #error "7.5\" ePaper sketch requires ESP32 or Pi Pico — AVR is too small."
#endif

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold18pt7b.h>

#if defined(ARDUINO_ARCH_ESP32)
  #define EPD_CS    5
  #define EPD_DC    17
  #define EPD_RST   16
  #define EPD_BUSY  4
#else
  #define EPD_CS    9
  #define EPD_DC    8
  #define EPD_RST   12
  #define EPD_BUSY  13
#endif

GxEPD2_BW<GxEPD2_750_T7, 16> display(GxEPD2_750_T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("ePaper 7.5\" hello-world"));

  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold18pt7b);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(60, 100);
    display.print(F("Velxio"));
    display.setCursor(60, 200);
    display.print(F("7.5\" e-Paper"));
    display.setCursor(60, 300);
    display.print(F("800 x 480"));
  } while (display.nextPage());

  display.hibernate();
  Serial.println(F("Frame written; controller in deep sleep."));
}

void loop() { delay(1000); }
