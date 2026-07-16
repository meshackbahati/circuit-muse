/*
 * eeprom-24lc256.c — 32 KB I2C EEPROM (24LC256-class).
 *
 * Differences vs 24C01:
 *   - 32 KB capacity (vs 128 bytes)
 *   - Two-byte address (high then low) → 16-bit address space
 *   - Same 7-bit base I2C address 0x50, A0/A1/A2 set the low bits.
 *
 * Protocol on the bus (master writes):
 *     1st byte  = address high
 *     2nd byte  = address low
 *     3rd+      = data, sequential write with auto-increment
 * Master reads return memory at the current pointer, auto-incrementing.
 */

#include "velxio-chip.h"
#include <stdlib.h>
#include <string.h>

#define EEPROM_BASE_ADDR 0x50
#define EEPROM_SIZE      0x8000   /* 32768 = 32 KB */

typedef enum {
  ST_IDLE,
  ST_HAS_HIGH,
  ST_HAS_FULL_ADDRESS,
} ee_state;

typedef struct {
  vx_pin a0, a1, a2, wp;
  uint16_t pointer;
  uint8_t  mem[EEPROM_SIZE];
  ee_state state;
} chip_state_t;

static bool i2c_connect(void* ud, uint8_t addr, bool is_read) {
  chip_state_t* s = (chip_state_t*)ud;
  if (!is_read) s->state = ST_IDLE;
  return true;
}

static uint8_t i2c_read(void* ud) {
  chip_state_t* s = (chip_state_t*)ud;
  uint8_t b = s->mem[s->pointer & (EEPROM_SIZE - 1)];
  s->pointer = (uint16_t)((s->pointer + 1) & (EEPROM_SIZE - 1));
  return b;
}

static bool i2c_write(void* ud, uint8_t byte) {
  chip_state_t* s = (chip_state_t*)ud;
  switch (s->state) {
    case ST_IDLE:
      s->pointer = (uint16_t)((byte & 0x7f) << 8);
      s->state = ST_HAS_HIGH;
      break;
    case ST_HAS_HIGH:
      s->pointer = (uint16_t)((s->pointer & 0xff00) | byte);
      s->state = ST_HAS_FULL_ADDRESS;
      break;
    case ST_HAS_FULL_ADDRESS:
      s->mem[s->pointer & (EEPROM_SIZE - 1)] = byte;
      s->pointer = (uint16_t)((s->pointer + 1) & (EEPROM_SIZE - 1));
      break;
  }
  return true;
}

static void i2c_stop(void* ud) {
  chip_state_t* s = (chip_state_t*)ud;
  s->state = ST_IDLE;
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  s->a0 = vx_pin_register("A0", VX_INPUT);
  s->a1 = vx_pin_register("A1", VX_INPUT);
  s->a2 = vx_pin_register("A2", VX_INPUT);
  s->wp = vx_pin_register("WP", VX_INPUT);

  uint8_t addr = EEPROM_BASE_ADDR
               | ((vx_pin_read(s->a2) & 1) << 2)
               | ((vx_pin_read(s->a1) & 1) << 1)
               | ((vx_pin_read(s->a0) & 1));

  vx_i2c_config cfg = {
    .address    = addr,
    .scl        = vx_pin_register("SCL", VX_INPUT),
    .sda        = vx_pin_register("SDA", VX_INPUT),
    .on_connect = i2c_connect,
    .on_read    = i2c_read,
    .on_write   = i2c_write,
    .on_stop    = i2c_stop,
    .user_data  = s,
  };
  vx_i2c_attach(&cfg);

  vx_log("24LC256 EEPROM ready");
}
