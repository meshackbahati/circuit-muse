/*
 * bus-driver — Phase 0 chip-to-chip bus proof (project/multichip-bus/ in the
 * velxio-prod repo). Drives a fixed byte 0xA5 onto an 8-bit data bus D0..D7 at
 * setup. No board involved; the only consumer is another custom chip
 * (bus-reader) wired straight across. Proves a shared chip-to-chip net key lets
 * one chip's write reach another chip's read.
 */
#include "velxio-chip.h"

void chip_setup(void) {
  const int byte = 0xA5; /* 1010 0101 */
  char name[4] = {'D', '0', 0, 0};
  for (int i = 0; i < 8; i++) {
    name[1] = (char)('0' + i);
    int bit = (byte >> i) & 1;
    /* OUTPUT_HIGH/LOW drives the level at registration time, so the byte is
     * present on the shared net immediately — no timer needed. */
    vx_pin_register(name, bit ? VX_OUTPUT_HIGH : VX_OUTPUT_LOW);
  }
}
