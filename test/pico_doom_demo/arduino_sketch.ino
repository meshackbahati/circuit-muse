/*
 * Pico Doom — A Wolf3D-style raycaster running on Raspberry Pi Pico.
 *
 * Hardware
 *   Raspberry Pi Pico (RP2040) + ILI9341 SPI TFT (320x240, landscape)
 *   4 pushbuttons: forward, backward, turn left, turn right
 *
 * Pins
 *   SPI0:  SCK=GP18  MOSI=GP19  CS=GP17  DC=GP20  RST=GP21  LED=GP22
 *   Buttons (active LOW, INPUT_PULLUP):
 *          FWD=GP10  BACK=GP11  LEFT=GP12  RIGHT=GP13
 *
 * Renderer
 *   DDA raycasting at 2-column step (160 rays / frame) — column-stripe
 *   drawing straight to the TFT, no framebuffer. Single-room 16x16 map
 *   with 5 wall styles (slate, blood, brown, green, door) painted darker
 *   on NS faces so corners read in 3D. Sky + floor are flat colour
 *   bands; the bottom 40 px is the HUD.
 *
 *   Why a demo and not the real id Software Doom: the canonical Pico
 *   port (Graham Sanderson's rp2040-doom) shoehorns the shareware WAD
 *   into 2 MB of flash with custom compression + PIO video timing the
 *   emulator can't reproduce. A column-wise raycaster gets you the
 *   "first-person 3D corridor" visual that Wolfenstein/early Doom both
 *   used, with zero external assets, and it fits in a 100-line sketch.
 *
 * Build
 *   FQBN: rp2040:rp2040:rpipico
 *   Required libraries: Adafruit_GFX, Adafruit_ILI9341, SPI (builtin).
 *
 * This is the source-of-truth file. The /examples gallery entry in
 * frontend/src/data/examples.ts is generated/copied from this sketch;
 * if you change the gameplay or wiring here, mirror it there.
 */

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <math.h>

// ─── Pins ──────────────────────────────────────────────────────────────
#define TFT_CS    17
#define TFT_DC    20
#define TFT_RST   21
#define TFT_LED   22
#define BTN_FWD   10
#define BTN_BACK  11
#define BTN_LEFT  12
#define BTN_RIGHT 13

Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);

// ─── Map (1=slate, 2=blood, 3=brown, 4=green, 5=door, 0=empty) ─────────
#define MAP_W 16
#define MAP_H 16
const uint8_t worldMap[MAP_H][MAP_W] = {
  {1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
  {1,0,0,0,0,0,0,2,2,2,0,0,0,0,0,1},
  {1,0,1,1,0,0,0,0,0,0,0,0,1,1,0,1},
  {1,0,1,0,0,0,3,3,0,0,0,0,0,0,0,1},
  {1,0,1,0,0,0,0,0,0,0,4,4,4,0,0,1},
  {1,0,1,1,1,0,0,5,5,0,0,0,0,0,0,1},
  {1,0,0,0,0,0,0,0,0,0,0,2,0,0,0,1},
  {1,0,3,3,3,3,0,0,0,2,2,0,0,0,0,1},
  {1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1},
  {1,0,0,0,0,5,5,0,0,3,0,0,0,0,0,1},
  {1,4,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
  {1,4,0,0,0,2,2,2,0,0,0,0,0,5,0,1},
  {1,4,0,0,0,0,0,0,0,0,3,3,3,0,0,1},
  {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
  {1,0,0,4,4,4,4,4,4,0,0,0,0,0,0,1},
  {1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
};

// ─── Player state ──────────────────────────────────────────────────────
float posX = 8.5f, posY = 8.5f;
float dirX = -1.0f, dirY = 0.0f;
float planeX = 0.0f, planeY = 0.66f;

// ─── Render constants ──────────────────────────────────────────────────
#define SCREEN_W 320
#define SCREEN_H 240
#define HUD_H    40
#define VIEW_H   (SCREEN_H - HUD_H)  // 200 — the actual 3D viewport
#define HALF_VH  (VIEW_H / 2)
#define SKY_COLOR   0x18C3
#define FLOOR_COLOR 0x4208

// 5 wall palettes (RGB565). NS faces are rendered with the dim variant
// so corners read correctly without per-pixel shading cost.
uint16_t wallColor(uint8_t tile, bool nsFace) {
  uint16_t c;
  switch (tile) {
    case 1: c = 0x8410; break;  // slate gray
    case 2: c = 0xC800; break;  // blood red
    case 3: c = 0x4A60; break;  // brown
    case 4: c = 0x32A0; break;  // toxic green
    case 5: c = 0xFD20; break;  // bronze door
    default: c = 0xFFFF; break;
  }
  if (nsFace) c = (c >> 1) & 0x7BEFu;  // darken
  return c;
}

void drawTitleScreen() {
  tft.fillScreen(ILI9341_BLACK);

  tft.setTextSize(6);
  tft.setTextColor(0xC800);  // blood red
  tft.setCursor(60, 40);
  tft.print("DOOM");

  tft.setTextSize(2);
  tft.setTextColor(0xFFE0);  // yellow
  tft.setCursor(50, 110);
  tft.print("Pico Edition");

  tft.setTextSize(1);
  tft.setTextColor(0xC618);
  tft.setCursor(40, 160);
  tft.print("FWD/BACK move   LEFT/RIGHT turn");

  tft.setTextSize(2);
  tft.setTextColor(0xFFFF);
  tft.setCursor(56, 200);
  tft.print("Press FWD to start");

  // Wait for the player to press FWD.
  while (digitalRead(BTN_FWD) == HIGH) {
    delay(40);
  }
  // Debounce — don't immediately walk into the wall.
  while (digitalRead(BTN_FWD) == LOW) {
    delay(40);
  }
}

void drawHUD() {
  tft.fillRect(0, SCREEN_H - HUD_H, SCREEN_W, HUD_H, 0x2104);  // dark gray bar
  tft.drawFastHLine(0, SCREEN_H - HUD_H, SCREEN_W, 0x52AA);

  tft.setTextSize(2);
  tft.setTextColor(0xFFE0);
  tft.setCursor(8, SCREEN_H - 28);
  tft.print("HP:100  ARM:50  AMMO:50");
}

// Render one frame. Sky/floor bands are repainted every frame (cheap
// fillRects) so the previous frame's wall columns get overwritten
// automatically — no separate clear pass needed.
void renderFrame() {
  // Sky covers the top half of the VIEW; floor the bottom half.
  tft.fillRect(0, 0,        SCREEN_W, HALF_VH, SKY_COLOR);
  tft.fillRect(0, HALF_VH,  SCREEN_W, HALF_VH, FLOOR_COLOR);

  for (int x = 0; x < SCREEN_W; x += 2) {
    // Camera-X in [-1, 1].
    float cameraX = 2.0f * x / SCREEN_W - 1.0f;
    float rayDirX = dirX + planeX * cameraX;
    float rayDirY = dirY + planeY * cameraX;

    int   mapX = (int)posX;
    int   mapY = (int)posY;
    float deltaDistX = (rayDirX == 0) ? 1e30f : fabsf(1.0f / rayDirX);
    float deltaDistY = (rayDirY == 0) ? 1e30f : fabsf(1.0f / rayDirY);

    int   stepX, stepY;
    float sideDistX, sideDistY;
    if (rayDirX < 0) { stepX = -1; sideDistX = (posX - mapX)        * deltaDistX; }
    else             { stepX =  1; sideDistX = (mapX + 1.0f - posX) * deltaDistX; }
    if (rayDirY < 0) { stepY = -1; sideDistY = (posY - mapY)        * deltaDistY; }
    else             { stepY =  1; sideDistY = (mapY + 1.0f - posY) * deltaDistY; }

    bool hit = false;
    bool nsFace = false;  // false = EW (vertical wall), true = NS (horizontal)
    int  iter = 0;
    while (!hit && iter++ < 64) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; nsFace = false; }
      else                       { sideDistY += deltaDistY; mapY += stepY; nsFace = true;  }
      if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) break;
      if (worldMap[mapY][mapX] > 0) hit = true;
    }
    if (!hit) continue;

    float perpDist = nsFace
      ? (mapY - posY + (1.0f - stepY) * 0.5f) / rayDirY
      : (mapX - posX + (1.0f - stepX) * 0.5f) / rayDirX;
    if (perpDist < 0.0001f) perpDist = 0.0001f;

    int lineH = (int)(VIEW_H / perpDist);
    int drawStart = HALF_VH - lineH / 2;
    int drawEnd   = HALF_VH + lineH / 2;
    if (drawStart < 0)        drawStart = 0;
    if (drawEnd   > VIEW_H)   drawEnd   = VIEW_H;

    uint16_t color = wallColor(worldMap[mapY][mapX], nsFace);
    // Draw two adjacent columns so the 2-px step doesn't show as gaps.
    tft.drawFastVLine(x,     drawStart, drawEnd - drawStart, color);
    tft.drawFastVLine(x + 1, drawStart, drawEnd - drawStart, color);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TFT_LED, OUTPUT);
  digitalWrite(TFT_LED, HIGH);
  pinMode(BTN_FWD,   INPUT_PULLUP);
  pinMode(BTN_BACK,  INPUT_PULLUP);
  pinMode(BTN_LEFT,  INPUT_PULLUP);
  pinMode(BTN_RIGHT, INPUT_PULLUP);

  tft.begin();
  tft.setRotation(3);  // landscape, 320×240

  drawTitleScreen();
  tft.fillScreen(ILI9341_BLACK);
  drawHUD();

  Serial.println(F("Pico Doom — raycaster ready"));
}

unsigned long lastFrameMs = 0;
const float MOVE_SPEED = 0.10f;
const float ROT_SPEED  = 0.08f;

void loop() {
  unsigned long now = millis();
  if (now - lastFrameMs < 100) return;  // cap at ~10 fps for the SPI bus
  lastFrameMs = now;

  // ── Input ───────────────────────────────────────────────────────────
  if (digitalRead(BTN_FWD) == LOW) {
    float nx = posX + dirX * MOVE_SPEED;
    float ny = posY + dirY * MOVE_SPEED;
    if (nx > 0 && nx < MAP_W && worldMap[(int)posY][(int)nx] == 0) posX = nx;
    if (ny > 0 && ny < MAP_H && worldMap[(int)ny][(int)posX] == 0) posY = ny;
  }
  if (digitalRead(BTN_BACK) == LOW) {
    float nx = posX - dirX * MOVE_SPEED;
    float ny = posY - dirY * MOVE_SPEED;
    if (nx > 0 && nx < MAP_W && worldMap[(int)posY][(int)nx] == 0) posX = nx;
    if (ny > 0 && ny < MAP_H && worldMap[(int)ny][(int)posX] == 0) posY = ny;
  }
  // Rotate by +/- ROT_SPEED radians.
  auto rotate = [](float &x, float &y, float a) {
    float ox = x;
    x = x * cosf(a) - y * sinf(a);
    y = ox * sinf(a) + y * cosf(a);
  };
  if (digitalRead(BTN_LEFT) == LOW) {
    rotate(dirX,   dirY,   ROT_SPEED);
    rotate(planeX, planeY, ROT_SPEED);
  }
  if (digitalRead(BTN_RIGHT) == LOW) {
    rotate(dirX,   dirY,   -ROT_SPEED);
    rotate(planeX, planeY, -ROT_SPEED);
  }

  // ── Render ──────────────────────────────────────────────────────────
  renderFrame();
}
