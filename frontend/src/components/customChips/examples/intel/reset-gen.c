/*
 * reset-gen — power-on reset + control-line pull-ups for a Z80 bus computer
 * (Phase 3, project/multichip-bus/). Holds RESET low at power-on, then drives
 * it HIGH after ~2 ms (a rising edge that releases the CPU). Ties WAIT, BUSREQ,
 * INT and NMI high (deasserted) so the CPU runs freely. Lets a multi-chip Z80
 * machine boot on its own when the user clicks Run.
 */
#include "velxio-chip.h"

static vx_pin reset_;
static vx_timer t;

static void release(void* ud) { (void)ud; vx_pin_write(reset_, 1); }

void chip_setup(void) {
  reset_ = vx_pin_register("RESET", VX_OUTPUT_LOW);   /* hold CPU in reset */
  vx_pin_register("WAIT",   VX_OUTPUT_HIGH);
  vx_pin_register("BUSREQ", VX_OUTPUT_HIGH);
  vx_pin_register("INT",    VX_OUTPUT_HIGH);
  vx_pin_register("NMI",    VX_OUTPUT_HIGH);
  t = vx_timer_create(release, 0);
  vx_timer_start(t, 2000000ULL, false);               /* one-shot, ~2 ms */
}
