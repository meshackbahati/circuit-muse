/*
 * cd4094.c — 8-stage shift-and-store register (CD4094-style).
 *
 * Pins: VDD, VSS, CLK, DATA, STR (strobe), OE, QS (serial out), QSN (serial out, falling-edge),
 *       Q1..Q8 (parallel outputs).
 *
 * Behavior:
 *   - On CLK rising edge: shift DATA bit into the internal register (MSB first into Q8 chain).
 *   - On STR rising edge: latch the internal register to Q1..Q8 outputs.
 *   - OE: output enable (we ignore for now and always drive).
 *   - QS / QSN: cascade serial outputs that mirror the bit being shifted out the high end.
 *   - Without VDD power, all outputs are forced LOW.
 */

#include "velxio-chip.h"
#include <stdlib.h>

static const char* Q_NAMES[8] = {"Q1","Q2","Q3","Q4","Q5","Q6","Q7","Q8"};

typedef struct {
  vx_pin VDD, VSS;
  vx_pin CLK, DATA, STR, OE;
  vx_pin QS, QSN;
  vx_pin Q[8];
  uint8_t bit;     /* index of the next bit to write (counts down 7..0 then wraps) */
  uint8_t reg;     /* shift register contents */
  uint8_t prev;    /* previously latched value (used by QS/QSN cascade) */
} chip_state_t;

static int has_power(chip_state_t* s) {
  return vx_pin_read(s->VDD) && !vx_pin_read(s->VSS);
}

static void on_clk_change(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;

  if (!has_power(s)) {
    for (int i = 0; i < 8; i++) vx_pin_write(s->Q[i], VX_LOW);
    return;
  }

  /* Push the MSB of `prev` to the cascade output chosen by CLK polarity. */
  vx_pin q_pin = vx_pin_read(s->CLK) ? s->QS : s->QSN;
  vx_pin_write(q_pin, (s->prev & 0x80) ? VX_HIGH : VX_LOW);

  if (vx_pin_read(s->CLK)) {
    /* Rising edge: shift DATA into bit position s->bit. */
    if (vx_pin_read(s->DATA)) s->reg |= (uint8_t)(1 << s->bit);
    else                      s->reg &= (uint8_t)~(1 << s->bit);
    s->bit = s->bit > 0 ? s->bit - 1 : 7;
  } else {
    /* Falling edge: shift the cascade chain so QS reflects the next outgoing bit. */
    s->prev = (uint8_t)(s->prev << 1);
  }
}

static void on_strobe_change(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;
  for (int i = 0; i < 8; i++) {
    int bit_val = (s->reg >> i) & 1;
    vx_pin_write(s->Q[i], bit_val ? VX_HIGH : VX_LOW);
  }
  s->prev = s->reg;
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  s->VDD  = vx_pin_register("VDD",  VX_INPUT);
  s->VSS  = vx_pin_register("VSS",  VX_INPUT);
  s->CLK  = vx_pin_register("CLK",  VX_INPUT);
  s->DATA = vx_pin_register("DATA", VX_INPUT);
  s->STR  = vx_pin_register("STR",  VX_INPUT);
  s->OE   = vx_pin_register("OE",   VX_INPUT);
  s->QS   = vx_pin_register("QS",   VX_OUTPUT);
  s->QSN  = vx_pin_register("QSN",  VX_OUTPUT);
  for (int i = 0; i < 8; i++) {
    s->Q[i] = vx_pin_register(Q_NAMES[i], VX_OUTPUT);
  }
  s->bit = 7;

  vx_pin_watch(s->CLK, VX_EDGE_BOTH,    on_clk_change,    s);
  vx_pin_watch(s->STR, VX_EDGE_RISING,  on_strobe_change, s);

  vx_log("CD4094 shift register ready");
}
