# 04 — Arduino libraries we must compile against

To "support" an ePaper panel in Velxio, the firmware libraries the user
writes against must compile **and** their generated SPI traffic must hit
our emulator's command/data state machine cleanly. There are four common
families:

## 1. GxEPD2 by Jean-Marc Zingg — **the de-facto standard**

- **Repo**: <https://github.com/ZinggJM/GxEPD2>
- **Library Manager name**: `GxEPD2` (latest 1.5.x as of 2026-04)
- **Architectures**: AVR, SAMD, ESP8266, ESP32, RP2040, mbed, STM32
- **Depends on**: `Adafruit_GFX` (graphics primitives)

Class hierarchy (relevant pieces only):

```
GxEPD2_BW<DRV, page_height>     — single-plane B/W
GxEPD2_3C<DRV, page_height>     — two-plane B/W/Red
GxEPD2_4G<DRV, page_height>     — 4-grey
GxEPD2_7C<DRV, page_height>     — 7-colour ACeP
```

Where `DRV` is one of ~80 driver classes named after the **panel** (e.g.
`GxEPD2_154_D67` for the 1.54" 200×200 SSD1681 panel). Each driver knows
its controller's init sequence and command set; the user just instantiates
the right one.

```c++
// Canonical "hello world"
#include <GxEPD2_BW.h>
GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(
    GxEPD2_154_D67(/*CS=*/ 5, /*DC=*/ 17, /*RST=*/ 16, /*BUSY=*/ 4));

void setup() {
  display.init();
  display.setFullWindow();
  display.firstPage();
  do { display.fillScreen(GxEPD_WHITE); display.setCursor(10, 30);
       display.print("Hello"); } while (display.nextPage());
}
```

The constructor's pin order is **(CS, DC, RST, BUSY)**. Important for the
emulator's `pin_map` — we must surface those four pin names verbatim.

## 2. Adafruit_EPD — Adafruit's official driver

- **Repo**: <https://github.com/adafruit/Adafruit_EPD>
- **Library Manager name**: `Adafruit EPD`
- **Architectures**: SAMD, ESP32, ESP8266 (no AVR — too little RAM for full framebuffer)
- **Depends on**: `Adafruit_GFX`, `Adafruit_BusIO`

Used heavily for the **MagTag**, **2.13" Featherwing** etc. Driver classes
are named per-controller rather than per-panel:

```c++
#include "Adafruit_SSD1681.h"
#define EPD_DC      6
#define EPD_CS      9
#define EPD_BUSY    -1
#define SRAM_CS     -1
#define EPD_RESET   -1
Adafruit_SSD1681 display(200, 200, EPD_DC, EPD_RESET, EPD_CS, SRAM_CS, EPD_BUSY);
```

Pin order here is **(DC, RST, CS, SRAM_CS, BUSY)** — totally different from
GxEPD2. Both must be supported by the Velxio component's pin labels.

## 3. ESPHome `waveshare_epaper`

Used by users coming from Home Assistant. YAML configures the panel; the
generated C++ uses the same SSD168x command flow. We don't need a
dedicated path — if Adafruit_EPD compiles, ESPHome compiles.

## 4. Pervasive Displays (PDLS) library family

- **Repo**: <https://github.com/Pervasive-Displays>
- Niche; powers the EPD Extension Board for Pervasive's 1.44"–4.2" panels.
- **Out of scope** for Phase 1.

## Library/board compatibility matrix

| Library | AVR (Uno) | RP2040 (Pico) | ESP32 | ESP32-S3 | ESP32-C3 |
|---|:---:|:---:|:---:|:---:|:---:|
| GxEPD2 | ✓ (only ≤2.13" — RAM) | ✓ | ✓ | ✓ | ✓ |
| Adafruit_EPD | ✗ (RAM) | ✓ | ✓ | ✓ | ✓ |
| ESPHome waveshare | ✗ | ✗ | ✓ | ✓ | ✓ |
| Pervasive PDLS | ✓ | ✓ | ✓ | ✓ | ✓ |

The "AVR ≤2.13"" caveat is because GxEPD2 needs `panel_W * page_height / 8`
bytes of SRAM. For 4.2" 400×300 with the default 8-row page_height that's
1.5 KB which fits Uno, but with 80-row pages (typical) it's 12 KB which
doesn't.

## Notes for the test harness

- The cross-board compile test (`test_compile_*`) should bundle GxEPD2 and
  Adafruit_GFX as required libraries. Both ship to `~/Arduino/libraries/`
  via `arduino-cli lib install GxEPD2 Adafruit_GFX`.
- The Velxio Library Manager UI already supports auto-installing libraries
  from a sketch's `#include` lines (see
  `frontend/src/components/simulator/InstallLibrariesModal.tsx`); the
  GxEPD2 #include should auto-trigger the install path on first compile.

## Sources

- GxEPD2: <https://github.com/ZinggJM/GxEPD2>
- GxEPD2 panel selection header: <https://github.com/ZinggJM/GxEPD2/blob/master/examples/GxEPD2_Example/GxEPD2_display_selection.h>
- Adafruit_EPD: <https://github.com/adafruit/Adafruit_EPD>
- Adafruit SSD1681 driver: <https://github.com/adafruit/Adafruit_EPD/blob/master/src/drivers/Adafruit_SSD1681.cpp>
- ESPHome waveshare_epaper: <https://api-docs.esphome.io/waveshare__epaper_8cpp_source>
