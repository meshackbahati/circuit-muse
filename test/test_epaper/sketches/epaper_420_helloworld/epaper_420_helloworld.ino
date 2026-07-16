/*
 * epaper_420_helloworld — 4.2" 400×300 SSD1683 / UC8176 panel.
 *
 * AVR Uno does NOT have enough flash for this driver — guarded with
 * #error. Use ESP32 or Pi Pico.
 */

#include <Arduino.h>

#if defined(ARDUINO_ARCH_AVR)
  #error "4.2\" ePaper sketch requires more flash than AVR Uno provides — use ESP32 or Pi Pico."
#endif

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold12pt7b.h>

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

GxEPD2_BW<GxEPD2_420_GDEY042T81, 16> display(GxEPD2_420_GDEY042T81(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("ePaper 4.2\" hello-world"));

  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold12pt7b);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(40, 80);
    display.print(F("Velxio"));
    display.setCursor(40, 130);
    display.print(F("4.2\" Dashboard"));
    display.setCursor(40, 180);
    display.print(F("400 x 300"));
  } while (display.nextPage());

  display.hibernate();
  Serial.println(F("Frame written; controller in deep sleep."));
}

void loop() { delay(1000); }
