/*
 * epaper_154_helloworld — canonical "Hello, World!" for the 1.54" 200x200
 * SSD1681 ePaper panel using GxEPD2.
 *
 * This sketch is the reference test bed for Velxio's ePaper emulator. It
 * targets the GxEPD2_154_D67 driver (Good Display GDEH0154D67 / Waveshare
 * 1.54" V2). The same sketch should compile cleanly for ESP32, Raspberry
 * Pi Pico (RP2040), and Arduino Uno (AVR) — the only thing that changes
 * between targets is the pin assignments.
 *
 * Wiring (GxEPD2 constructor pin order: CS, DC, RST, BUSY):
 *
 *   ─────────────  ESP32 (DevKit V1)  ──────────────
 *     CS   = GPIO 5
 *     DC   = GPIO 17
 *     RST  = GPIO 16
 *     BUSY = GPIO 4
 *     SCK  = GPIO 18  (default HSPI/VSPI SCK)
 *     MOSI = GPIO 23  (default VSPI MOSI)
 *
 *   ─────────────  Raspberry Pi Pico  ────────────────
 *     CS   = GP9
 *     DC   = GP8
 *     RST  = GP12
 *     BUSY = GP13
 *     SCK  = GP10  (SPI1 SCK)
 *     MOSI = GP11  (SPI1 TX)
 *
 *   ─────────────  Arduino Uno  ──────────────────────
 *     CS   = D10
 *     DC   = D9
 *     RST  = D8
 *     BUSY = D7
 *     SCK  = D13  (hardware SPI SCK)
 *     MOSI = D11  (hardware SPI MOSI)
 *
 * Required Arduino libraries:
 *   - GxEPD2          (Library Manager: "GxEPD2")
 *   - Adafruit_GFX    (auto-installed as a GxEPD2 dependency)
 */

#include <Arduino.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>

// ── Per-target pin selection ────────────────────────────────────────────────
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
#else  // AVR (Uno / Nano / Mega)
  #define EPD_CS    10
  #define EPD_DC    9
  #define EPD_RST   8
  #define EPD_BUSY  7
#endif

// 1.54" 200x200 V2 (SSD1681) — the most common Phase-1 panel.
// `HEIGHT` page size of 16 keeps RAM usage at 400 bytes/page so AVR users
// can still build the sketch.
GxEPD2_BW<GxEPD2_154_D67, 16> display(GxEPD2_154_D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("ePaper 1.54\" hello-world (Velxio test sketch)"));

  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold9pt7b);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, 60);
    display.print(F("Velxio"));
    display.setCursor(20, 100);
    display.print(F("ePaper"));
    display.setCursor(20, 140);
    display.print(F("OK!"));
  } while (display.nextPage());

  display.hibernate();
  Serial.println(F("Frame written; controller in deep sleep."));
}

void loop() {
  // No-op — ePaper is bistable; image stays without power.
  delay(1000);
}
