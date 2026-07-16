/*
 * inverter.c — minimal Velxio custom chip
 *
 * Two pins: IN (input) and OUT (output). OUT mirrors the inverse of IN.
 *
 * Build:
 *   bash scripts/compile-chip.sh sdk/examples/inverter.c fixtures/inverter.wasm
 */

#include "velxio-chip.h"
#include <stdlib.h>

typedef struct {
  vx_pin in;
  vx_pin out;
} chip_state_t;

static void on_in_change(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;
  vx_pin_write(s->out, value ? VX_LOW : VX_HIGH);
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)malloc(sizeof(chip_state_t));
  s->in  = vx_pin_register("IN",  VX_INPUT);
  s->out = vx_pin_register("OUT", VX_OUTPUT);

  /* Initialize OUT to inverse of current IN state. */
  vx_pin_write(s->out, vx_pin_read(s->in) ? VX_LOW : VX_HIGH);

  /* React to every edge on IN. */
  vx_pin_watch(s->in, VX_EDGE_BOTH, on_in_change, s);

  vx_log("inverter ready");
}
