# 02 — ePaper controller IC families

Every panel ships with one of a small set of controllers. The panel's
size/resolution/colour-mode is glued to a specific controller — the
firmware library (GxEPD2, Adafruit_EPD, ESPHome `waveshare_epaper`) picks
the controller-specific driver based on the panel name, but the
**SPI command set is what we actually emulate**.

## The Solomon Systech SSD168x family (B/W mono, B/W/R)

This is by far the most common family for small panels (1.54"–4.2"). They
all share ~95% of the command set; differences are mainly RAM size and
which driver-output config bytes are accepted.

| Controller | Typical panel | RAM (px) | Colours | Notes |
|---|---|---|---|---|
| **SSD1675A** (= IL3897) | 2.13" 250×122 | 250×122 | B/W or B/W/R | Two RAM planes for tri-colour |
| **SSD1680** | 2.13" / 2.9" tri-colour | 296×128 max | B/W or B/W/R | Newer revision of SSD1675 |
| **SSD1681** | 1.54" 200×200 | 200×200 | B/W | Smallest, fastest init |
| **SSD1683** | 4.2" 400×300 | 400×300 | B/W | 4.2" upgrade path |
| **SSD1677** | 7.5" 880×528 | 880×528 | B/W/R | Higher-res Solomon part |

## The UltraChip family (mid + large mono, multi-colour)

Used by GoodDisplay / Waveshare 4.2" – 7.5" panels.

| Controller | Typical panel | RAM (px) | Colours | Notes |
|---|---|---|---|---|
| **UC8175** | 1.02" 80×128 | 80×128 | B/W | Small, hobbyist |
| **UC8176** | 4.2" 400×300 | 400×300 | B/W | Predates SSD1683 |
| **UC8179** (= GD7965) | 7.5" 800×480 | 800×480 | B/W or B/W/R | "DESPI-C02" PCB |
| **UC8159c** (= IL0371) | 5.65" 600×448 | 600×448 | **7-colour ACeP** | 4 px / byte (3-bit indices) |

## Spectra 6 (E Ink, used in Seeed 13.3" 1200×1600)

The **E Ink Spectra 6 13.3"** panel uses E Ink's own controller (datasheet
under NDA — community-reverse-engineered command set is in the GxEPD2
`epd13in3E` driver). Six colours: black, white, yellow, red, green, blue.
Encoded as **3 bits/pixel packed 2 px/byte**.

Key commands (subset, from GxEPD2 `epd13in3E.cpp`):

| Hex | Mnemonic | Notes |
|---|---|---|
| 0x00 | PSR (panel setting) | Resolution + colour-mode |
| 0x04 | POWER ON | Followed by BUSY high until panel boot |
| 0x10 | DTM1 | Image data plane |
| 0x12 | DRF | Display refresh — triggers ~12 s update |
| 0x07 | DEEP SLEEP | data byte 0xA5 |

## IT8951 (Carta 6"–13.3" greyscale)

Used by Seeed EE03 + Waveshare 6"/7.8"/9.7"/10.3" Carta panels. **Not
SPI-raw**; it's a packet-based command stream over SPI with a "SYS_RUN"
boot handshake. Out of scope for Phase 1.

## Common command sequence (SSD1681 example)

The host's typical flow after power-on:

```
HW reset (RST low > 200 µs, high)
poll BUSY low
0x12 SWRST                   ── soft reset
poll BUSY low
0x01 OUTPUT_CTRL              data: 0xC7 0x00 0x00     (display height-1)
0x11 DATA_ENTRY_MODE          data: 0x03               (X+ Y+, addr X then Y)
0x44 SET_RAMX_RANGE           data: 0x00 0x18          (start col, end col)
0x45 SET_RAMY_RANGE           data: 0x00 0x00 0xC7 0x00
0x3C BORDER_WAVEFORM          data: 0x05
0x21 DISPLAY_UPDATE_CTRL_1    data: 0x00 0x80          (BW + bypass red)
0x18 TEMPSENSOR_SELECT        data: 0x80
0x4E SET_RAMX_COUNTER         data: 0x00
0x4F SET_RAMY_COUNTER         data: 0x00 0x00
poll BUSY low

── frame loop ──
0x24 WRITE_BLACK_VRAM         data: <W*H/8 bytes of pixel data>
0x22 SET_DISP_UPDATE_CTRL_2   data: 0xF7               (full update)
0x20 ACTIVE_DISP_UPDATE_SEQ   (no data)
poll BUSY high → low (~1s)

0x10 SLEEP_CTRL               data: 0x01               (deep sleep)
```

## Sources

- SSD1681 datasheet (Adafruit mirror): <https://cdn-learn.adafruit.com/assets/assets/000/099/573/original/SSD1681.pdf>
- SSD1681 datasheet (BuyDisplay mirror): <https://www.buydisplay.com/download/ic/SSD1681.pdf>
- SSD1677 / 1680 / etc. archive: <https://cursedhardware.github.io/epd-driver-ic/>
- ESP-BSP SSD1681 command header: <https://github.com/espressif/esp-bsp/blob/master/components/lcd/esp_lcd_ssd1681/esp_lcd_ssd1681_commands.h>
- Adafruit_EPD (SSD1675 driver): <https://github.com/adafruit/Adafruit_EPD/blob/master/src/drivers/Adafruit_SSD1675.h>
- libdriver SSD1681: <https://github.com/libdriver/ssd1681>
