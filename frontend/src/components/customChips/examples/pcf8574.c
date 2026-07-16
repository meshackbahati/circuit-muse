/*
 * pcf8574.c — 8-bit I2C I/O expander.
 *
 * Pins: A0, A1, A2 (address bits, base 0x20), SDA, SCL, INT (open-drain interrupt),
 *       P0..P7 (quasi-bidirectional I/O lines).
 *
 * Protocol: master writes 1 byte → drives Px outputs to that pattern.
 *           master reads 1 byte → returns the current state of Px lines.
 * (Real PCF8574 quasi-bidirectional behavior simplified: outputs latch the
 * master's writes; reads expose the latched value or external drivers.)
 */

#include "velxio-chip.h"
#include <stdlib.h>

#define PCF_BASE_ADDR 0x20

static const char* P_NAMES[8] = {"P0","P1","P2","P3","P4","P5","P6","P7"};

typedef struct {
  vx_pin A0, A1, A2, INT;
  vx_pin P[8];
  uint8_t latched;   /* last value written by the master */
} chip_state_t;

static bool on_connect(void* ud, uint8_t addr, bool is_read) { return true; }

static void update_outputs(chip_state_t* s) {
  for (int i = 0; i < 8; i++) {
    vx_pin_write(s->P[i], (s->latched >> i) & 1 ? VX_HIGH : VX_LOW);
  }
}

static bool on_write(void* ud, uint8_t byte) {
  chip_state_t* s = (chip_state_t*)ud;
  s->latched = byte;
  update_outputs(s);
  return true;
}

static uint8_t on_read(void* ud) {
  chip_state_t* s = (chip_state_t*)ud;
  /* Reading returns the line state — for outputs we drove, that's `latched`;
   * for inputs (pin read by host), we'd read each pin. Simplification: return
   * the pin reads OR the latch as the current state of each line. */
  uint8_t val = 0;
  for (int i = 0; i < 8; i++) {
    if (vx_pin_read(s->P[i])) val |= (uint8_t)(1 << i);
  }
  return val;
}

static void on_stop(void* ud) { /* no-op */ }

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  s->A0  = vx_pin_register("A0",  VX_INPUT);
  s->A1  = vx_pin_register("A1",  VX_INPUT);
  s->A2  = vx_pin_register("A2",  VX_INPUT);
  s->INT = vx_pin_register("INT", VX_OUTPUT_HIGH);   /* open-drain, idle HIGH */
  for (int i = 0; i < 8; i++) {
    s->P[i] = vx_pin_register(P_NAMES[i], VX_OUTPUT_HIGH);
  }
  s->latched = 0xff;   /* power-on default per datasheet */
  update_outputs(s);

  uint8_t addr = PCF_BASE_ADDR
               | ((vx_pin_read(s->A2) & 1) << 2)
               | ((vx_pin_read(s->A1) & 1) << 1)
               | ((vx_pin_read(s->A0) & 1));

  vx_i2c_config cfg = {
    .address    = addr,
    .scl        = vx_pin_register("SCL", VX_INPUT),
    .sda        = vx_pin_register("SDA", VX_INPUT),
    .on_connect = on_connect,
    .on_read    = on_read,
    .on_write   = on_write,
    .on_stop    = on_stop,
    .user_data  = s,
  };
  vx_i2c_attach(&cfg);

  vx_log("PCF8574 I/O expander ready");
}
