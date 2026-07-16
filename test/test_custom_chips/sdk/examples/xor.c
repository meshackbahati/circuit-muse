/*
 * xor.c — 2-input XOR gate.
 *
 * Pins: A (input), B (input), OUT (output), VCC, GND.
 * OUT = A ^ B, recomputed on every edge of A or B.
 */

#include "velxio-chip.h"
#include <stdlib.h>

typedef struct {
  vx_pin a, b, out;
} chip_state_t;

static void update_output(chip_state_t* s) {
  int a = vx_pin_read(s->a);
  int b = vx_pin_read(s->b);
  vx_pin_write(s->out, (a ^ b) ? VX_HIGH : VX_LOW);
}

static void on_input_change(void* ud, vx_pin pin, int value) {
  update_output((chip_state_t*)ud);
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)malloc(sizeof(chip_state_t));
  s->a   = vx_pin_register("A",   VX_INPUT);
  s->b   = vx_pin_register("B",   VX_INPUT);
  s->out = vx_pin_register("OUT", VX_OUTPUT);

  vx_pin_watch(s->a, VX_EDGE_BOTH, on_input_change, s);
  vx_pin_watch(s->b, VX_EDGE_BOTH, on_input_change, s);

  update_output(s);
  vx_log("XOR gate ready");
}
