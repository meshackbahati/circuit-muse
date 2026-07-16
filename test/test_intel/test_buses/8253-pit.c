/*
 * Intel 8253 Programmable Interval Timer — Modes 0, 2, 3 subset.
 *
 * The 8253 (and pin-compatible 8254) is a 24-pin DIP that gives a CPU
 * three independent 16-bit countdown counters. Each counter has its
 * own external CLK input and GATE input plus an OUT output. Six
 * counting modes; we implement the three most common:
 *
 *   Mode 0 (interrupt on terminal count): OUT low after writing the
 *   control word; once a count is loaded and GATE is high, OUT stays
 *   low until count counts down to zero, then goes high (and stays
 *   high until a new count is written).
 *
 *   Mode 2 (rate generator): OUT goes low for one CLK then back high;
 *   counter automatically reloads. Used for periodic system-tick.
 *
 *   Mode 3 (square wave): OUT toggles every (count/2) CLKs (for even
 *   counts); used for PC-speaker tone generation.
 *
 * Source: Intel 8253/8254 Datasheet (public mirror, bitsavers.org).
 *
 * Pin contract (24-pin DIP):
 *   D0..D7    bidirectional 8-bit data bus
 *   A0, A1    inputs — register select (00/01/10 = counters; 11 = ctrl)
 *   CS̅, RD̅, WR̅
 *   CLK0..2   inputs — counter clocks (rising edge counts)
 *   GATE0..2  inputs — counter enable (high = enable)
 *   OUT0..2   outputs — counter outputs (mode-specific behaviour)
 *   VCC, GND
 *
 * Control word format:
 *   bits 7..6: counter select (00=ch0, 01=ch1, 10=ch2, 11=read-back NI)
 *   bits 5..4: read/write mode
 *      00 = latch counter for read
 *      01 = read/write LSB only
 *      10 = read/write MSB only
 *      11 = read/write LSB then MSB
 *   bits 3..1: counting mode (we implement 0, 2, 3)
 *   bit  0:    0 = binary, 1 = BCD (BCD not supported)
 *
 * Modes 1, 4, 5 are not implemented; control writes selecting them
 * load as Mode 0 with a warning (silently).
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    /* Per-counter state */
    uint8_t  mode;          /* 0, 2, or 3 (others coerced to 0) */
    uint8_t  rw_mode;       /* 0 = latch, 1 = LSB, 2 = MSB, 3 = LSB-then-MSB */
    bool     write_high_next;  /* for rw_mode == 3 */
    bool     read_high_next;
    uint16_t reload;        /* loaded count value */
    uint16_t count;         /* current count */
    uint16_t latched;       /* snapshot for read-back */
    bool     have_latched;
    bool     out_state;
    bool     armed;         /* count is loaded and ready */
} channel_t;

typedef struct {
    vx_pin d[8];
    vx_pin a0, a1;
    vx_pin cs, rd, wr;
    vx_pin clk[3];
    vx_pin gate[3];
    vx_pin out[3];
    vx_pin vcc, gnd;

    channel_t ch[3];
    bool driving_d;
    int  wr_last;
} chip_t;

static chip_t G;

/* ─── D-bus helpers ─────────────────────────────────────────────────────── */
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

static void drive_out(int idx, bool high) {
    G.ch[idx].out_state = high;
    vx_pin_write(G.out[idx], high ? 1 : 0);
}

/* ─── Control word parsing ──────────────────────────────────────────────── */
static void apply_control(uint8_t cw) {
    int sel = (cw >> 6) & 3;
    int rw  = (cw >> 4) & 3;
    int mode = (cw >> 1) & 7;
    if (sel == 3) return;   /* read-back command — not supported */
    channel_t* c = &G.ch[sel];
    c->rw_mode = rw;
    if (rw == 0) {
        /* Latch: snapshot current count for next read. */
        c->latched = c->count;
        c->have_latched = true;
        return;
    }
    /* Coerce unsupported modes to 0. */
    if (mode != 0 && mode != 2 && mode != 3) mode = 0;
    c->mode = (uint8_t)mode;
    c->armed = false;
    c->write_high_next = false;
    c->read_high_next  = false;
    /* OUT goes low after a control word for Mode 0; high for 2 and 3. */
    drive_out(sel, mode != 0);
}

/* Counter byte write. */
static void counter_write(int idx, uint8_t byte) {
    channel_t* c = &G.ch[idx];
    switch (c->rw_mode) {
        case 1: /* LSB */
            c->reload = (c->reload & 0xFF00) | byte;
            c->count = c->reload;
            c->armed = true;
            break;
        case 2: /* MSB */
            c->reload = (uint16_t)((c->reload & 0x00FF) | ((uint16_t)byte << 8));
            c->count = c->reload;
            c->armed = true;
            break;
        case 3: /* LSB then MSB */
            if (!c->write_high_next) {
                c->reload = (c->reload & 0xFF00) | byte;
                c->write_high_next = true;
                /* Counter is "disarmed" between LSB and MSB writes. */
                c->armed = false;
            } else {
                c->reload = (uint16_t)((c->reload & 0x00FF) | ((uint16_t)byte << 8));
                c->count = c->reload;
                c->armed = true;
                c->write_high_next = false;
            }
            break;
    }
}

static uint8_t counter_read(int idx) {
    channel_t* c = &G.ch[idx];
    uint16_t value = c->have_latched ? c->latched : c->count;
    switch (c->rw_mode) {
        case 1: /* LSB */
            c->have_latched = false;
            return (uint8_t)(value & 0xFF);
        case 2: /* MSB */
            c->have_latched = false;
            return (uint8_t)(value >> 8);
        case 3: /* LSB then MSB */
            if (!c->read_high_next) {
                c->read_high_next = true;
                return (uint8_t)(value & 0xFF);
            } else {
                c->read_high_next = false;
                c->have_latched = false;
                return (uint8_t)(value >> 8);
            }
        default:
            c->have_latched = false;
            return (uint8_t)(value & 0xFF);
    }
}

/* ─── CLK rising-edge per channel: count down. ──────────────────────────── */
static void on_clk(void* user_data, vx_pin pin, int value) {
    int idx = (int)(intptr_t)user_data;
    (void)pin;
    if (value != 1) return;
    if (vx_pin_read(G.gate[idx]) == 0) return;
    channel_t* c = &G.ch[idx];
    if (!c->armed) return;

    switch (c->mode) {
        case 0: /* interrupt on terminal count */
            if (c->count > 0) c->count--;
            if (c->count == 0) {
                drive_out(idx, true);
                /* Stay at 0 until new count is loaded (count is 0xFFFF
                   on next CLK; we just leave at 0). */
                c->armed = false;
            }
            break;
        case 2: /* rate generator */
            if (c->count > 0) c->count--;
            if (c->count == 1) {
                drive_out(idx, false);
            } else if (c->count == 0) {
                drive_out(idx, true);
                c->count = c->reload;
            }
            break;
        case 3: { /* square wave — decrement by 2 each CLK */
            if (c->count >= 2) c->count -= 2;
            else c->count = 0;
            if (c->count == 0) {
                drive_out(idx, !c->out_state);
                c->count = c->reload;
            }
            break;
        }
    }
}

/* ─── RD / WR strobes ───────────────────────────────────────────────────── */
static void on_rd(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { release_d(); return; }
    if (value != 0) { release_d(); return; }
    int sel = (vx_pin_read(G.a1) ? 2 : 0) | (vx_pin_read(G.a0) ? 1 : 0);
    if (sel == 3) { drive_d(0); return; }   /* control reg reads back undefined */
    drive_d(counter_read(sel));
}
static void on_wr(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { G.wr_last = value; return; }
    if (G.wr_last == 0 && value == 1) {
        int sel = (vx_pin_read(G.a1) ? 2 : 0) | (vx_pin_read(G.a0) ? 1 : 0);
        uint8_t byte = read_d_byte();
        if (sel == 3) apply_control(byte);
        else          counter_write(sel, byte);
    }
    G.wr_last = value;
}

void chip_setup(void) {
    char name[6];
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.a0 = vx_pin_register("A0", VX_INPUT);
    G.a1 = vx_pin_register("A1", VX_INPUT);
    G.cs = vx_pin_register("CS", VX_INPUT);
    G.rd = vx_pin_register("RD", VX_INPUT);
    G.wr = vx_pin_register("WR", VX_INPUT);
    for (int i = 0; i < 3; i++) {
        name[0]='C'; name[1]='L'; name[2]='K'; name[3]='0'+i; name[4]=0;
        G.clk[i]  = vx_pin_register(name, VX_INPUT);
        name[0]='G'; name[1]='A'; name[2]='T'; name[3]='E'; name[4]='0'+i; name[5]=0;
        G.gate[i] = vx_pin_register(name, VX_INPUT);
        name[0]='O'; name[1]='U'; name[2]='T'; name[3]='0'+i; name[4]=0;
        G.out[i]  = vx_pin_register(name, VX_OUTPUT_LOW);
    }
    G.vcc = vx_pin_register("VCC", VX_INPUT);
    G.gnd = vx_pin_register("GND", VX_INPUT);

    for (int i = 0; i < 3; i++) {
        G.ch[i] = (channel_t){0};
        drive_out(i, false);
    }
    G.driving_d = false;
    G.wr_last = 1;

    vx_pin_watch(G.rd, VX_EDGE_BOTH, on_rd, 0);
    vx_pin_watch(G.wr, VX_EDGE_BOTH, on_wr, 0);
    for (int i = 0; i < 3; i++) {
        vx_pin_watch(G.clk[i], VX_EDGE_RISING, on_clk, (void*)(intptr_t)i);
    }
}
