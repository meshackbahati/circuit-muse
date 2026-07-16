/*
 * Intel 8255 Programmable Peripheral Interface — Mode 0 only.
 *
 * The 8255 is a 40-pin DIP that gives a CPU three 8-bit ports (A, B,
 * C) with programmable direction. Mode 0 is the simplest: each port
 * (and the upper/lower halves of port C independently) can be set to
 * input or output via writes to the control register.
 *
 * Source: Intel 8255A Datasheet (public domain mirror on bitsavers).
 *
 * Pin contract (40-pin DIP):
 *   D0..D7    bidirectional 8-bit data bus
 *   PA0..PA7  bidirectional — direction set by control register
 *   PB0..PB7  bidirectional
 *   PC0..PC7  bidirectional — upper and lower halves independent
 *   A0, A1    input — register select:
 *                00 = port A, 01 = port B, 10 = port C, 11 = control
 *   CS̅        input — active-low chip enable
 *   RD̅        input — active-low read strobe
 *   WR̅        input — active-low write strobe
 *   RESET     input — active-high; clears all ports to input mode
 *   VCC, GND
 *
 * Control word format (Mode 0 only — bit 7 = 1):
 *   bit 7: 1 = set mode (0 = bit set/reset on port C — not supported)
 *   bit 6,5: group-A mode (00 = mode 0)
 *   bit 4: PA direction (1 = input, 0 = output)
 *   bit 3: PC upper (PC4..PC7) direction
 *   bit 2: group-B mode (0 = mode 0)
 *   bit 1: PB direction
 *   bit 0: PC lower (PC0..PC3) direction
 *
 * Mode 1 (strobed I/O) and Mode 2 (bidirectional) are NOT implemented.
 * Bit set/reset operations on port C (control byte with bit 7 = 0)
 * are NOT implemented yet.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    vx_pin d[8];
    vx_pin pa[8];
    vx_pin pb[8];
    vx_pin pc[8];
    vx_pin a0, a1;
    vx_pin cs, rd, wr, reset_;
    vx_pin vcc, gnd;

    /* Direction flags: 1 = input (we don't drive), 0 = output (we drive) */
    bool pa_input;
    bool pb_input;
    bool pc_low_input;     /* PC0..PC3 */
    bool pc_high_input;    /* PC4..PC7 */

    /* Latched output values per port (used when in output mode) */
    uint8_t pa_out;
    uint8_t pb_out;
    uint8_t pc_out;

    bool driving_d;
    int  wr_last;
    int  rd_last;
} chip_t;

static chip_t G;

/* ─── Helpers ───────────────────────────────────────────────────────────── */

static uint8_t read_d_byte(void) {
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

static uint8_t read_port(vx_pin* port) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(port[i])) v |= (1u << i);
    return v;
}
static void drive_port(vx_pin* port, uint8_t v, uint8_t mask_output) {
    /* Drive only the bits marked as output (mask_output=1 → output) */
    for (int i = 0; i < 8; i++) {
        if (mask_output & (1 << i)) {
            vx_pin_set_mode(port[i], VX_OUTPUT);
            vx_pin_write(port[i], (v >> i) & 1);
        } else {
            vx_pin_set_mode(port[i], VX_INPUT);
        }
    }
}

static uint8_t cur_port_addr(void) {
    return (vx_pin_read(G.a1) ? 2 : 0) | (vx_pin_read(G.a0) ? 1 : 0);
}

static void apply_directions(void) {
    drive_port(G.pa, G.pa_out, G.pa_input ? 0x00 : 0xFF);
    drive_port(G.pb, G.pb_out, G.pb_input ? 0x00 : 0xFF);
    uint8_t pc_mask = 0;
    if (!G.pc_low_input)  pc_mask |= 0x0F;
    if (!G.pc_high_input) pc_mask |= 0xF0;
    drive_port(G.pc, G.pc_out, pc_mask);
}

static void apply_control(uint8_t c) {
    if ((c & 0x80) == 0) {
        /* Bit set/reset operation — not implemented. */
        return;
    }
    G.pc_low_input  = (c & 0x01) != 0;
    G.pb_input      = (c & 0x02) != 0;
    G.pc_high_input = (c & 0x08) != 0;
    G.pa_input      = (c & 0x10) != 0;
    /* Reset output latches per the datasheet: control writes clear
       any previously-driven output values to 0. */
    G.pa_out = 0;
    G.pb_out = 0;
    G.pc_out = 0;
    apply_directions();
}

static void reset_state(void) {
    /* RESET clears the chip: all ports become inputs (Mode 0, all in). */
    G.pa_input = true;
    G.pb_input = true;
    G.pc_low_input = true;
    G.pc_high_input = true;
    G.pa_out = G.pb_out = G.pc_out = 0;
    G.wr_last = 1;
    G.rd_last = 1;
    apply_directions();
    release_d();
}

/* ─── Read / Write strobes ──────────────────────────────────────────────── */

static void on_rd(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { release_d(); return; }
    if (value == 0) {
        /* RD̅ asserted → drive D with the selected register's value */
        uint8_t addr = cur_port_addr();
        uint8_t v = 0;
        switch (addr) {
            case 0: v = G.pa_input ? read_port(G.pa) : G.pa_out; break;
            case 1: v = G.pb_input ? read_port(G.pb) : G.pb_out; break;
            case 2: {
                uint8_t pc_lo = G.pc_low_input  ? (read_port(G.pc) & 0x0F) : (G.pc_out & 0x0F);
                uint8_t pc_hi = G.pc_high_input ? (read_port(G.pc) & 0xF0) : (G.pc_out & 0xF0);
                v = pc_lo | pc_hi;
                break;
            }
            case 3: v = 0; break;   /* control register read returns 0 (datasheet: undefined) */
        }
        drive_d(v);
    } else {
        release_d();
    }
}

static void on_wr(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { G.wr_last = value; return; }
    /* Latch on rising edge of WR̅ (deassert), per Intel datasheet. */
    if (G.wr_last == 0 && value == 1) {
        uint8_t addr = cur_port_addr();
        uint8_t v = read_d_byte();
        switch (addr) {
            case 0: G.pa_out = v; break;
            case 1: G.pb_out = v; break;
            case 2: G.pc_out = v; break;
            case 3: apply_control(v); break;
        }
        apply_directions();
    }
    G.wr_last = value;
}

static void on_reset(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) reset_state();
}

void chip_setup(void) {
    char name[5];

    for (int i = 0; i < 8; i++) { name[0]='D'; name[1]='0'+i; name[2]=0; G.d[i]  = vx_pin_register(name, VX_INPUT); }
    for (int i = 0; i < 8; i++) { name[0]='P'; name[1]='A'; name[2]='0'+i; name[3]=0; G.pa[i] = vx_pin_register(name, VX_INPUT); }
    for (int i = 0; i < 8; i++) { name[0]='P'; name[1]='B'; name[2]='0'+i; name[3]=0; G.pb[i] = vx_pin_register(name, VX_INPUT); }
    for (int i = 0; i < 8; i++) { name[0]='P'; name[1]='C'; name[2]='0'+i; name[3]=0; G.pc[i] = vx_pin_register(name, VX_INPUT); }
    G.a0     = vx_pin_register("A0",    VX_INPUT);
    G.a1     = vx_pin_register("A1",    VX_INPUT);
    G.cs     = vx_pin_register("CS",    VX_INPUT);
    G.rd     = vx_pin_register("RD",    VX_INPUT);
    G.wr     = vx_pin_register("WR",    VX_INPUT);
    G.reset_ = vx_pin_register("RESET", VX_INPUT);
    G.vcc    = vx_pin_register("VCC",   VX_INPUT);
    G.gnd    = vx_pin_register("GND",   VX_INPUT);

    reset_state();

    vx_pin_watch(G.rd,     VX_EDGE_BOTH,    on_rd,    0);
    vx_pin_watch(G.wr,     VX_EDGE_BOTH,    on_wr,    0);
    vx_pin_watch(G.reset_, VX_EDGE_RISING,  on_reset, 0);
}
