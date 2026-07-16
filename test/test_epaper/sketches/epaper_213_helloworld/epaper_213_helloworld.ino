/*
 * epaper_213_helloworld — 2.13" 250×122 SSD1675A / IL3897 panel.
 *
 * Same wiring + structure as the 1.54" sketch; only the GxEPD2 driver
 * class changes. Compiles for AVR / RP2040 / ESP32 (paged mode keeps
 * AVR Uno's RAM happy).
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

GxEPD2_BW<GxEPD2_213_B72, 16> display(GxEPD2_213_B72(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("ePaper 2.13\" hello-world"));

  display.init(115200, true, 50, false);
  display.setRotation(1);  // 250×122 landscape
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold9pt7b);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, 30);
    display.print(F("Velxio"));
    display.setCursor(20, 60);
    display.print(F("2.13\""));
    display.setCursor(20, 90);
    display.print(F("OK!"));
  } while (display.nextPage());

  display.hibernate();
  Serial.println(F("Frame written; controller in deep sleep."));
}

void loop() { delay(1000); }
