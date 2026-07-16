# 01 — Seeed Studio ePaper catalog (target panels)

Source: <https://www.seeedstudio.com/ePaper-E-Ink-c-2378.html> and the
`xiao_epaper_display_board_overview` wiki at
<https://wiki.seeedstudio.com/xiao_epaper_display_board_overview/>.

## What Seeed actually sells

Seeed's strategy is a small family of **driver boards** that pair a XIAO
MCU (RP2040 / ESP32-S3 / ESP32-C3) with a generic e-paper FPC connector,
plus a la carte **panels**. The user-cited 13.3" Spectra 6 is the largest
panel in this family.

| Driver board / panel | MCU on board | Connector | Panel size(s) supported | Resolution(s) | Colours |
|---|---|---|---|---|---|
| **EE02** (XIAO ePaper Display Board EE02) | XIAO ESP32-S3 Plus | dedicated 24-pin | 13.3" Spectra 6 only | 1200×1600 | 6 (B/W/Y/R/G/B) |
| **EE03** | XIAO RP2040 / ESP32-S3 | 50-pin | 10.3" mono Carta | 1872×1404 | B/W (16 grey) |
| **EE04** | XIAO ESP32-S3 | 24-pin + 50-pin | 1.54"…7.5" panels | varies | B/W, B/W/R, 7-colour |
| **EN04** | XIAO ESP32-C3 | 24-pin + 50-pin | 1.54"…7.5" panels | varies | same as EE04 |
| **2.13" 250×122 mono panel** (sold standalone) | – | 24-pin FPC | 2.13" | 250×122 | B/W |
| **2.9" 296×128 mono panel** | – | 24-pin FPC | 2.9" | 296×128 | B/W |
| **4.2" 400×300 mono panel** | – | 24-pin FPC | 4.2" | 400×300 | B/W |
| **5.65" 600×448 7-colour panel** | – | 24-pin FPC | 5.65" | 600×448 | 7 (ACeP) |
| **7.5" 800×480 mono / B/W/R panel** | – | 24-pin FPC | 7.5" | 800×480 | B/W or B/W/R |
| **13.3" Spectra 6** ([6569](https://www.seeedstudio.com/13-3inch-Six-Color-eInk-ePaper-Display-with-1200x1600-Pixels-p-6569.html)) | – (paired with EE02) | dedicated 24-pin | 13.3" | 1200×1600 | 6 |

## Velxio shortlist (Phase 1)

To cover most user demand without exploding scope, the first emulator drop
should support these 5 representative panels:

| Velxio metadata id | Panel | Resolution | Colours | Controller IC | Notes |
|---|---|---|---|---|---|
| `epaper-1in54-bw` | 1.54" 200×200 | 200×200 | B/W | SSD1681 | Smallest, simplest, fast init |
| `epaper-2in13-bw` | 2.13" 250×122 | 250×122 | B/W | SSD1675A / IL3897 | Classic ESP-NOW badge |
| `epaper-2in9-bw` | 2.9" 296×128 | 296×128 | B/W | SSD1680 | Common in retail tags |
| `epaper-4in2-bw` | 4.2" 400×300 | 400×300 | B/W | UC8176 / SSD1683 | Mid-size, partial update |
| `epaper-7in5-bw` | 7.5" 800×480 | 800×480 | B/W | UC8179 / GD7965 | Largest mono |

Phase 2 colour panels:

| Velxio metadata id | Panel | Resolution | Colours | Controller IC |
|---|---|---|---|---|
| `epaper-2in13-bwr` | 2.13" tri-colour | 250×122 | B/W/Red | SSD1680 |
| `epaper-5in65-7c` | 5.65" 7-colour ACeP | 600×448 | 7 (ACeP) | UC8159c |
| `epaper-13in3-spectra6` | 13.3" Spectra 6 (Seeed 6569) | 1200×1600 | 6 | EPD13in3E (Spectra 6 controller) |

## What about IT8951?

The **6"–10.3" Carta panels** (EE03) use Waveshare's IT8951 driver HAT,
which exposes a serial protocol over SPI/USB rather than raw waveform
control. Different beast — defer to Phase 3.

## Sources

- Seeed catalog index: <https://www.seeedstudio.com/ePaper-E-Ink-c-2378.html>
- 13.3" Spectra 6 product page: <https://www.seeedstudio.com/13-3inch-Six-Color-eInk-ePaper-Display-with-1200x1600-Pixels-p-6569.html>
- XIAO ePaper driver board overview: <https://wiki.seeedstudio.com/xiao_epaper_display_board_overview/>
- Hackster coverage: <https://www.hackster.io/news/seeed-studio-s-epaper-kits-go-big-with-a-13-3-e-ink-spectra-6-six-color-panel-f75f81290c29>
- CNX Software EE02 review: <https://www.cnx-software.com/2026/01/10/xiao-epaper-diy-kit-ee02-an-esp32-s3-board-designed-for-13-3-inch-spectra-6-color-e-ink-display/>
