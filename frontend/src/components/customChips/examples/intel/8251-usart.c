/*
 * Intel 8251 USART — basic asynchronous-mode UART.
 *
 * The 8251 is a 28-pin DIP that gives a CPU programmable serial I/O.
 * The full datasheet covers two operating modes (asynchronous and
 * synchronous), parity, multi-byte init sequence (mode word + sync
 * chars + command word), and a swarm of modem-control pins. This
 * implementation handles the common subset:
 *   - Async mode, 8-data-bits, 1 stop bit, no parity (the 90% case)
 *   - Mode word loaded once after RESET
 *   - Command word: TxEnable / RxEnable / DTR / RTS / Reset
 *
 * Bit-banging of TxD / RxD is delegated to the velxio runtime via
 * `vx_uart_attach` — same mechanism used by the existing uart-rot13
 * example chip. Baud rate is derived from the divisor in the mode word
 * (we hardcode 9600 if not initialised; runtime scales internally).
 *
 * Pin contract:
 *   D0..D7   bidirectional
 *   RD̅, WR̅   active-low strobes
 *   CS̅       active-low chip enable
 *   C/D̅      0 = data register, 1 = control register (mode/command/status)
 *   RESET    active-high (clears state, returns to "expecting mode word")
 *   CLK      input clock (informational; we use the runtime's bit timing)
 *   TxD, RxD serial lines
 *   TxRDY, RxRDY, TxEMPTY  status outputs
 *   DSR̅, DTR̅, CTS̅, RTS̅  modem-control pins (passed-through; not
 *                          interpreted by this minimal implementation)
 *   VCC, GND
 *
 * The status register at C/D̅=1, RD̅:
 *   bit 0  TxRDY    (1 = ready to accept next byte)
 *   bit 1  RxRDY    (1 = received byte available)
 *   bit 2  TxEMPTY  (1 = transmitter idle)
 *   bits 3..7  framing/parity error / SYNDET / DSR̅ — we report 0
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

typedef enum {
    INIT_EXPECT_MODE = 0,
    INIT_EXPECT_COMMAND,
    INIT_RUNNING,
} init_state_t;

typedef struct {
    vx_pin d[8];
    vx_pin rd, wr, cs, cd;
    vx_pin reset_;
    vx_pin clk;
    vx_pin txd, rxd;
    vx_pin tx_rdy, rx_rdy, tx_empty;
    vx_pin dsr, dtr, cts, rts;
    vx_pin vcc, gnd;

    vx_uart uart;

    /* Internal state */
    init_state_t init_state;
    uint8_t  mode_word;
    uint8_t  command_word;
    uint8_t  rx_byte;
    bool     rx_ready;
    bool     tx_enabled;
    bool     rx_enabled;
    bool     tx_busy;
    bool     driving_d;

    int wr_last;
} chip_t;

static chip_t G;

/* ─── D bus ─────────────────────────────────────────────────────────────── */
static uint8_t read_d(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.d[i])) v |= (1u << i);
    return v;
}
static void drive_d(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.d[i], VX_OUTPUT);
        vx_pin_write(G.d[i], (v >> i) & 1);
    }
    G.driving_d = true;
}
static void release_d(void) {
    if (!G.driving_d) return;
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.d[i], VX_INPUT);
    G.driving_d = false;
}

static uint8_t status_byte(void) {
    uint8_t v = 0;
    if (!G.tx_busy && G.tx_enabled) v |= 0x01;   /* TxRDY */
    if (G.rx_ready)                  v |= 0x02;   /* RxRDY */
    if (!G.tx_busy)                  v |= 0x04;   /* TxEMPTY */
    return v;
}

static void update_status_pins(void) {
    vx_pin_write(G.tx_rdy,   (G.tx_enabled && !G.tx_busy) ? 1 : 0);
    vx_pin_write(G.rx_rdy,   G.rx_ready ? 1 : 0);
    vx_pin_write(G.tx_empty, !G.tx_busy ? 1 : 0);
}

/* ─── UART callbacks ────────────────────────────────────────────────────── */

static void on_rx_byte(void* user_data, uint8_t byte) {
    (void)user_data;
    if (!G.rx_enabled) return;
    G.rx_byte = byte;
    G.rx_ready = true;
    update_status_pins();
}
static void on_tx_done(void* user_data) {
    (void)user_data;
    G.tx_busy = false;
    update_status_pins();
}

/* ─── RD / WR strobes ───────────────────────────────────────────────────── */

static void on_rd(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { release_d(); return; }
    if (value != 0) { release_d(); return; }
    if (vx_pin_read(G.cd)) {
        /* Status read */
        drive_d(status_byte());
    } else {
        /* Data read — return the latched RX byte; clear RxRDY. */
        drive_d(G.rx_byte);
        G.rx_ready = false;
        update_status_pins();
    }
}

static void on_wr(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { G.wr_last = value; return; }
    if (G.wr_last == 0 && value == 1) {
        uint8_t v = read_d();
        if (vx_pin_read(G.cd)) {
            /* Control write: mode or command depending on state. */
            switch (G.init_state) {
                case INIT_EXPECT_MODE:
                    G.mode_word = v;
                    /* We only support async mode (bits 0-1 = baud-rate
                       factor != 0) in this implementation. We don't
                       parse parity / sync. */
                    G.init_state = INIT_EXPECT_COMMAND;
                    break;
                case INIT_EXPECT_COMMAND:
                case INIT_RUNNING:
                    G.command_word = v;
                    G.tx_enabled = (v & 0x01) != 0;
                    G.rx_enabled = (v & 0x04) != 0;
                    /* Bit 6 = internal reset: returns to expecting mode word. */
                    if (v & 0x40) {
                        G.init_state = INIT_EXPECT_MODE;
                        G.tx_enabled = false;
                        G.rx_enabled = false;
                    } else if (G.init_state == INIT_EXPECT_COMMAND) {
                        G.init_state = INIT_RUNNING;
                    }
                    /* DTR / RTS pass-through to pins (active low). */
                    vx_pin_write(G.dtr, (v & 0x02) ? 0 : 1);
                    vx_pin_write(G.rts, (v & 0x20) ? 0 : 1);
                    update_status_pins();
                    break;
            }
        } else {
            /* Data write: queue a byte for transmission. */
            if (G.tx_enabled) {
                G.tx_busy = true;
                vx_uart_write(G.uart, &v, 1);
                update_status_pins();
            }
        }
    }
    G.wr_last = value;
}

static void on_reset(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) {
        G.init_state = INIT_EXPECT_MODE;
        G.tx_enabled = false;
        G.rx_enabled = false;
        G.tx_busy = false;
        G.rx_ready = false;
        G.mode_word = 0;
        G.command_word = 0;
        update_status_pins();
        release_d();
    }
}

void chip_setup(void) {
    char name[8];

    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.rd       = vx_pin_register("RD",      VX_INPUT);
    G.wr       = vx_pin_register("WR",      VX_INPUT);
    G.cs       = vx_pin_register("CS",      VX_INPUT);
    G.cd       = vx_pin_register("CD",      VX_INPUT);
    G.reset_   = vx_pin_register("RESET",   VX_INPUT);
    G.clk      = vx_pin_register("CLK",     VX_INPUT);
    G.txd      = vx_pin_register("TXD",     VX_OUTPUT_HIGH);
    G.rxd      = vx_pin_register("RXD",     VX_INPUT);
    G.tx_rdy   = vx_pin_register("TXRDY",   VX_OUTPUT_LOW);
    G.rx_rdy   = vx_pin_register("RXRDY",   VX_OUTPUT_LOW);
    G.tx_empty = vx_pin_register("TXEMPTY", VX_OUTPUT_HIGH);
    G.dsr      = vx_pin_register("DSR",     VX_INPUT);
    G.dtr      = vx_pin_register("DTR",     VX_OUTPUT_HIGH);
    G.cts      = vx_pin_register("CTS",     VX_INPUT);
    G.rts      = vx_pin_register("RTS",     VX_OUTPUT_HIGH);
    G.vcc      = vx_pin_register("VCC",     VX_INPUT);
    G.gnd      = vx_pin_register("GND",     VX_INPUT);

    G.init_state = INIT_EXPECT_MODE;
    G.tx_enabled = false;
    G.rx_enabled = false;
    G.tx_busy = false;
    G.rx_ready = false;
    G.driving_d = false;
    G.wr_last = 1;

    /* Attach to the UART-bus abstraction. The runtime handles bit-level
       timing; we just queue bytes via vx_uart_write and receive via
       on_rx_byte. */
    vx_uart_config cfg = {
        .rx = G.rxd,
        .tx = G.txd,
        .baud_rate = 9600,
        .on_rx_byte = on_rx_byte,
        .on_tx_done = on_tx_done,
        .user_data = 0,
        .reserved = {0,0,0,0,0,0,0,0},
    };
    G.uart = vx_uart_attach(&cfg);

    update_status_pins();

    vx_pin_watch(G.rd,     VX_EDGE_BOTH,    on_rd,    0);
    vx_pin_watch(G.wr,     VX_EDGE_BOTH,    on_wr,    0);
    vx_pin_watch(G.reset_, VX_EDGE_RISING,  on_reset, 0);
}
