/*
 * bus-reader — Phase 0 chip-to-chip bus proof (project/multichip-bus/ in the
 * velxio-prod repo). Reads the 8-bit data bus D0..D7 and mirrors it onto
 * OUT0..OUT7 (which would drive 8 LEDs in the app). Polls on a 1 ms timer so it
 * is order-independent w.r.t. the driver's setup. If chip-to-chip keying works,
 * OUT == whatever the driver put on the bus (0xA5).
 */
#include "velxio-chip.h"

static vx_pin D[8];
static vx_pin OUT[8];

static void poll(void* ud) {
  (void)ud;
  for (int i = 0; i < 8; i++) {
    int v = vx_pin_read(D[i]);
    vx_pin_write(OUT[i], v);
  }
}

void chip_setup(void) {
  char dn[4] = {'D', '0', 0, 0};
  for (int i = 0; i < 8; i++) {
    dn[1] = (char)('0' + i);
    D[i] = vx_pin_register(dn, VX_INPUT);
  }
  char on[5] = {'O', 'U', 'T', '0', 0};
  for (int i = 0; i < 8; i++) {
    on[3] = (char)('0' + i);
    OUT[i] = vx_pin_register(on, VX_OUTPUT_LOW);
  }
  vx_timer t = vx_timer_create(poll, (void*)0);
  vx_timer_start(t, 1000000ULL, true); /* 1 ms, repeating */
}
