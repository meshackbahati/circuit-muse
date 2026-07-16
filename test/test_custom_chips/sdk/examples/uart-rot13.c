/*
 * uart-rot13.c — UART chip that returns each received byte ROT13-shifted.
 *
 * For testing the host's UART implementation. The chip listens on RX,
 * applies ROT13 to alphabetic characters (others pass through), and
 * sends the result on TX.
 */

#include "velxio-chip.h"
#include <stdlib.h>

typedef struct {
  vx_uart uart;
} chip_state_t;

static uint8_t rot13(uint8_t v) {
  if (v >= 'A' && v <= 'Z') return (uint8_t)(v + 13 <= 'Z' ? v + 13 : v - 13);
  if (v >= 'a' && v <= 'z') return (uint8_t)(v + 13 <= 'z' ? v + 13 : v - 13);
  return v;
}

static void on_rx(void* ud, uint8_t byte) {
  chip_state_t* s = (chip_state_t*)ud;
  uint8_t out = rot13(byte);
  vx_uart_write(s->uart, &out, 1);
}

static void on_tx_done(void* ud) {
  /* nothing to do — chip is ready for the next byte. */
}

void chip_setup(void) {
  chip_state_t* s = (chip_state_t*)malloc(sizeof(chip_state_t));

  vx_uart_config cfg = {
    .rx          = vx_pin_register("RX", VX_INPUT),
    .tx          = vx_pin_register("TX", VX_INPUT_PULLUP),
    .baud_rate   = 115200,
    .on_rx_byte  = on_rx,
    .on_tx_done  = on_tx_done,
    .user_data   = s,
  };
  s->uart = vx_uart_attach(&cfg);

  vx_log("ROT13 UART chip ready");
}
