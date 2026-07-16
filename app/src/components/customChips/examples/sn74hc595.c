/*
 * sn74hc595.c — 8-bit SPI shift register with output latches.
 *
 * Pins: SER (data in, MOSI), SRCLK (shift clock, SCK), RCLK (latch / CS),
 *       SRCLR (active-low clear), OE (output enable), QH' (cascade out, MISO),
 *       Q0..Q7 (parallel outputs).
 *
 * Wired as an SPI slave: SER=MOSI, SRCLK=SCK, RCLK acts as our chip-select
 * (rising edge latches the shift register to the output stage).
 *
 * Behavior:
 *   - On every SPI byte, 8 bits shift into the internal register.
 *   - On RCLK rising edge, the register copies to Q0..Q7.
 *   - SRCLR LOW resets the register and outputs to 0.
 *   - QH' echoes the bit being shifted out the high end (cascade).
 */

#include "velxio-chip.h"
#include <stdlib.h>
#include <string.h>

static const char* Q_NAMES[8] = {"Q0","Q1","Q2","Q3","Q4","Q5","Q6","Q7"};

typedef struct {
  vx_pin SER, SRCLK, RCLK, SRCLR, OE, QH;
  vx_pin Q[8];
  vx_spi spi;
  uint8_t spi_buf[1];
  uint8_t shift_reg;   /* shift register (volatile) */
  uint8_t latch_reg;   /* latched outputs */
} chip_state_t;

static void update_outputs(chip_state_t* s) {
  for (int i = 0; i < 8; i++) {
    vx_pin_write(s->Q[i], (s->latch_reg >> i) & 1 ? VX_HIGH : VX_LOW);
  }
}

static void on_spi_done(void* ud, uint8_t* buffer, uint32_t count) {
  chip_state_t* s = (chip_state_t*)ud;
  /* Each received byte was shifted MSB-first; the resulting register equals
   * the last byte received (8-bit register, no cascade-in). */
  if (count > 0) {
    s->shift_reg = buffer[0];
  }
  /* Re-arm the SPI for the next byte (real 74HC595 has no CS — it shifts on
   * every SCK edge as long as data flows). */
  vx_spi_start(s->spi, s->spi_buf, 1);
}

static void on_rclk(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;
  /* RCLK rising edge → latch shift register to outputs. */
  s->latch_reg = s->shift_reg;
  update_outputs(s);
}

static void on_srclr(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;
  /* SRCLR is active LOW: when it goes LOW, clear the shift register.
   * Outputs only update on the next RCLK rising edge. */
  if (value == VX_LOW) {
    s->shift_reg = 0;
  }
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  s->SER   = vx_pin_register("SER",   VX_INPUT);
  s->SRCLK = vx_pin_register("SRCLK", VX_INPUT);
  s->RCLK  = vx_pin_register("RCLK",  VX_INPUT);
  s->SRCLR = vx_pin_register("SRCLR", VX_INPUT_PULLUP);
  s->OE    = vx_pin_register("OE",    VX_INPUT);
  s->QH    = vx_pin_register("QH",    VX_OUTPUT_LOW);
  for (int i = 0; i < 8; i++) {
    s->Q[i] = vx_pin_register(Q_NAMES[i], VX_OUTPUT_LOW);
  }

  vx_spi_config cfg = {
    .sck       = s->SRCLK,
    .mosi      = s->SER,
    .miso      = s->QH,
    .cs        = s->RCLK,   /* runtime ignores cs, chip drives via RCLK watch */
    .mode      = 0,
    .on_done   = on_spi_done,
    .user_data = s,
  };
  s->spi = vx_spi_attach(&cfg);

  /* Tell the host we want to receive 1 byte at a time on the SPI bus. */
  vx_spi_start(s->spi, s->spi_buf, 1);

  vx_pin_watch(s->RCLK,  VX_EDGE_RISING,  on_rclk,  s);
  vx_pin_watch(s->SRCLR, VX_EDGE_FALLING, on_srclr, s);

  vx_log("74HC595 shift register ready");
}
