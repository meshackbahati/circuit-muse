/*
 * mcp3008.c — 8-channel SPI ADC.
 *
 * Pins: CS, SCK, MOSI (DIN), MISO (DOUT), CH0..CH7 (analog inputs).
 *
 * Protocol: master sends a 3-byte command to start a conversion:
 *   byte 0: 0x01 (start bit)
 *   byte 1: top nibble = SGL/DIFF (1 bit) + channel (3 bits), shifted left
 *   byte 2: don't care
 * The chip responds with:
 *   byte 0: ignored
 *   byte 1: low 2 bits = upper bits of 10-bit result
 *   byte 2: lower 8 bits of result
 *
 * Each channel reads its analog voltage via vx_pin_read_analog().
 */

#include "velxio-chip.h"
#include <stdlib.h>
#include <string.h>

static const char* CH_NAMES[8] = {"CH0","CH1","CH2","CH3","CH4","CH5","CH6","CH7"};

typedef struct {
  vx_pin CS, SCK, MOSI, MISO;
  vx_pin CH[8];
  vx_spi spi;
  uint8_t buf[3];     /* SPI exchange buffer */
} chip_state_t;

static void on_cs_change(void* ud, vx_pin pin, int value) {
  chip_state_t* s = (chip_state_t*)ud;
  if (value == VX_LOW) {
    /* Pre-fill buffer: byte 0 ignored, bytes 1..2 will be filled with the
     * conversion result after the chip sees the command. For now, send 0xff
     * (NACK markers) and the on_done callback handles real responses. */
    s->buf[0] = 0xff;
    s->buf[1] = 0xff;
    s->buf[2] = 0xff;
    vx_spi_start(s->spi, s->buf, 3);
  } else {
    vx_spi_stop(s->spi);
  }
}

static void on_spi_done(void* ud, uint8_t* buffer, uint32_t count) {
  chip_state_t* s = (chip_state_t*)ud;
  if (count < 3) return;

  /* buffer now holds master's 3 bytes after the exchange completed.
   * Parse: byte[0] = start bit, byte[1] = SGL_DIFF+channel<<4 in upper nibble. */
  uint8_t start  = buffer[0] & 0x01;
  uint8_t header = buffer[1];
  uint8_t channel = (header >> 4) & 0x07;
  if (!start) return;

  /* Read the analog voltage and convert to 10-bit ADC value (0..1023, ref=5V). */
  double voltage = vx_pin_read_analog(s->CH[channel]);
  if (voltage < 0)   voltage = 0;
  if (voltage > 5.0) voltage = 5.0;
  uint16_t result = (uint16_t)((voltage / 5.0) * 1023.0 + 0.5);

  /* Set up the response for the next exchange — typical MCP3008 use sends
   * 3 master bytes to receive the full 10-bit value, but our buffer-based
   * model already overwrites in-place. To send the response back in the same
   * transaction we'd need to pre-fill before vx_spi_start. Since the master
   * ALREADY sent its 3 bytes, we record the result and the chip's miso pin
   * should be driven; for the test API, we use a follow-up start. */
  s->buf[0] = 0x00;
  s->buf[1] = (uint8_t)((result >> 8) & 0x03);  /* upper 2 bits */
  s->buf[2] = (uint8_t)(result & 0xff);          /* lower 8 bits */

  /* Begin the response exchange (same buffer, master will clock it out). */
  vx_spi_start(s->spi, s->buf, 3);
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)calloc(1, sizeof(chip_state_t));
  s->CS   = vx_pin_register("CS",   VX_INPUT_PULLUP);
  s->SCK  = vx_pin_register("SCK",  VX_INPUT);
  s->MOSI = vx_pin_register("MOSI", VX_INPUT);
  s->MISO = vx_pin_register("MISO", VX_OUTPUT_HIGH);

  for (int i = 0; i < 8; i++) {
    s->CH[i] = vx_pin_register(CH_NAMES[i], VX_ANALOG);
  }

  vx_spi_config cfg = {
    .sck       = s->SCK,
    .mosi      = s->MOSI,
    .miso      = s->MISO,
    .cs        = s->CS,
    .mode      = 0,
    .on_done   = on_spi_done,
    .user_data = s,
  };
  s->spi = vx_spi_attach(&cfg);

  vx_pin_watch(s->CS, VX_EDGE_BOTH, on_cs_change, s);

  vx_log("MCP3008 ADC ready");
}
