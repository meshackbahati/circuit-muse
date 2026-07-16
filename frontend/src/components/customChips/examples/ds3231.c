/*
 * ds3231.c — DS3231 high-precision I2C real-time clock.
 *
 * Pins: SDA, SCL, INT (alarm interrupt, open-drain), 32K (32 kHz output),
 *       RST (reset, active LOW).
 *
 * Address: 0x68 (fixed).
 *
 * Memory map (subset implemented):
 *   0x00 seconds   (BCD)
 *   0x01 minutes   (BCD)
 *   0x02 hours     (BCD, 24h)
 *   0x03 day-of-week (1..7)
 *   0x04 date      (BCD, 1..31)
 *   0x05 month     (BCD, 1..12)
 *   0x06 year      (BCD, 0..99 = 2000..2099)
 *   0x07-0x12 alarms / control (read-back as zero)
 *
 * Protocol: master writes 1 byte → register pointer.
 *           master writes more bytes → updates registers from pointer.
 *           master reads → returns from current pointer, auto-incrementing.
 */

#include "velxio-chip.h"
#include <stdlib.h>
#include <string.h>

#define RTC_ADDR     0x68
#define RTC_REG_COUNT 0x13

static uint8_t to_bcd(uint8_t n) { return (uint8_t)(((n / 10) << 4) | (n % 10)); }
static uint8_t from_bcd(uint8_t b) { return (uint8_t)(((b >> 4) & 0x0f) * 10 + (b & 0x0f)); }

typedef enum { ST_IDLE, ST_HAS_POINTER } rtc_state_t;

typedef struct {
  vx_pin SDA, SCL, INT, RST_PIN, OUT32K;
  uint8_t regs[RTC_REG_COUNT];
  uint8_t pointer;
  rtc_state_t state;
} chip_state_t;

static void seed_default_time(chip_state_t* s) {
  /* Default: 2026-01-15 12:34:56, Thursday */
  s->regs[0x00] = to_bcd(56);
  s->regs[0x01] = to_bcd(34);
  s->regs[0x02] = to_bcd(12);
  s->regs[0x03] = 4;          /* Thursday */
  s->regs[0x04] = to_bcd(15);
  s->regs[0x05] = to_bcd(1);
  s->regs[0x06] = to_bcd(26);
}

static bool on_connect(void* ud, uint8_t addr, bool is_read) {
  chip_state_t* s = (chip_state_t*)ud;
  if (!is_read) s->state = ST_IDLE;
  return true;
}

static bool on_write(void* ud, uint8_t byte) {
  chip_state_t* s = (chip_state_t*)ud;
  if (s->state == ST_IDLE) {
    s->pointer = byte % RTC_REG_COUNT;
    s->state = ST_HAS_POINTER;
  } else {
    s->regs[s->pointer] = byte;
    s->pointer = (uint8_t)((s->pointer + 1) % RTC_REG_COUNT);
  }
  return true;
}

static uint8_t on_read(void* ud) {
  chip_state_t* s = (chip_state_t*)ud;
  uint8_t b = s->regs[s->pointer];
  s->pointer = (uint8_t)((s->pointer + 1) % RTC_REG_COUNT);
  return b;
}

static void on_stop(void* ud) {
  chip_state_t* s = (chip_state_t*)ud;
  s->state = ST_IDLE;
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  seed_default_time(s);
  s->INT     = vx_pin_register("INT",   VX_OUTPUT_HIGH);
  s->RST_PIN = vx_pin_register("RST",   VX_INPUT_PULLUP);
  s->OUT32K  = vx_pin_register("32K",   VX_OUTPUT_LOW);

  vx_i2c_config cfg = {
    .address    = RTC_ADDR,
    .scl        = vx_pin_register("SCL", VX_INPUT),
    .sda        = vx_pin_register("SDA", VX_INPUT),
    .on_connect = on_connect,
    .on_read    = on_read,
    .on_write   = on_write,
    .on_stop    = on_stop,
    .user_data  = s,
  };
  vx_i2c_attach(&cfg);

  vx_log("DS3231 RTC ready (default 2026-01-15 12:34:56)");
  /* Suppress unused warning */
  (void)from_bcd;
}
