/*
 * Intel 8282 octal latch — clean-room implementation as a velxio
 * custom chip.
 *
 * Source: Intel 8282/8283 datasheet (2-page short form, public).
 * Used to demultiplex AD0..AD7 (or AD8..AD15) on 8086 minimum-mode
 * boards under control of ALE.
 *
 * Behaviour:
 *   STB=1, OE̅=0  → transparent: DOn tracks DIn
 *   STB 1→0       → latch: hold DOn at DIn captured during STB=1
 *   OE̅=1          → release DO pins (high-Z; we model as VX_INPUT)
 *
 * Implementation: pin watches on DI0..7 + STB + OE̅. On any change,
 * recompute outputs:
 *   - If OE̅=1: release DO pins.
 *   - Else if STB=1: drive DOn = DIn (transparent).
 *   - Else: drive DOn from the latched register (set at last STB=1).
 *
 * The 8283 (inverting variant) is NOT implemented here — would just
 * be the same logic with DOn = ~DIn.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    vx_pin di[8];
    vx_pin dout[8];
    vx_pin stb;
    vx_pin oe;
    vx_pin vcc, gnd;
    uint8_t latched;        /* held value when STB is low */
    bool driving;
} chip_t;

static chip_t G;

static uint8_t read_di(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.di[i])) v |= (1u << i);
    return v;
}

static void drive_do(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.dout[i], VX_OUTPUT);
        vx_pin_write(G.dout[i], (v >> i) & 1);
    }
    G.driving = true;
}

static void release_do(void) {
    if (!G.driving) return;
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.dout[i], VX_INPUT);
    G.driving = false;
}

static void update(void) {
    int oe_high = vx_pin_read(G.oe);
    int stb_high = vx_pin_read(G.stb);

    if (oe_high) {
        release_do();
        return;
    }

    if (stb_high) {
        /* Transparent: latched value tracks DI continuously while STB
           is high, AND we drive that value on DO. */
        G.latched = read_di();
        drive_do(G.latched);
    } else {
        /* Latched: DO holds whatever was last captured. */
        drive_do(G.latched);
    }
}

static void on_pin_change(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
    update();
}

void chip_setup(void) {
    char name[5];

    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='I'; name[2]='0'+i; name[3]=0;
        G.di[i] = vx_pin_register(name, VX_INPUT);
    }
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='O'; name[2]='0'+i; name[3]=0;
        G.dout[i] = vx_pin_register(name, VX_INPUT);
    }
    G.stb = vx_pin_register("STB", VX_INPUT);
    G.oe  = vx_pin_register("OE",  VX_INPUT);
    G.vcc = vx_pin_register("VCC", VX_INPUT);
    G.gnd = vx_pin_register("GND", VX_INPUT);

    G.latched = 0;
    G.driving = false;

    for (int i = 0; i < 8; i++) {
        vx_pin_watch(G.di[i], VX_EDGE_BOTH, on_pin_change, 0);
    }
    vx_pin_watch(G.stb, VX_EDGE_BOTH, on_pin_change, 0);
    vx_pin_watch(G.oe,  VX_EDGE_BOTH, on_pin_change, 0);

    update();
}
