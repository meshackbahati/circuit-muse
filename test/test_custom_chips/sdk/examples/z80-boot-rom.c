/*
 * z80-boot-rom — a rom-32k variant whose image is a tiny Z80 boot program,
 * for the Phase 0-2 live proof (project/multichip-bus/). Identical to
 * examples/intel/rom-32k.c except for rom_image, which holds:
 *
 *   0000: C3 06 00   JP 0x0006     ; requires reading C3,06,00 over the bus
 *   0003: 00 00 00   NOP x3        ; jumped over
 *   0006: 76         HALT          ; Z80 drives HALT low here -> observable
 *
 * Reaching HALT proves the Z80 fetched the multi-byte JP and its target from
 * this ROM across the shared data bus and executed it.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

#define ROM_SIZE 0x8000   /* 32 KB */

static const uint8_t rom_image[ROM_SIZE] = {
    [0x0000] = 0xC3, [0x0001] = 0x06, [0x0002] = 0x00, /* JP 0x0006 */
    [0x0003] = 0x00, [0x0004] = 0x00, [0x0005] = 0x00, /* NOP NOP NOP */
    [0x0006] = 0x76,                                   /* HALT */
};

typedef struct {
    vx_pin a[15];
    vx_pin d[8];
    vx_pin ce;
    vx_pin oe;
    vx_pin vcc;
    vx_pin gnd;
    bool driving;
} chip_t;

static chip_t G;

static uint16_t read_addr(void) {
    uint16_t v = 0;
    for (int i = 0; i < 15; i++) if (vx_pin_read(G.a[i])) v |= (1u << i);
    return v;
}

static uint8_t image_byte(uint16_t addr) {
    if (addr >= ROM_SIZE) return 0xFF;
    /* honour the programmed low bytes; an erased EPROM reads 0xFF elsewhere */
    if (addr >= 0x10) return 0xFF;
    return rom_image[addr];
}

static void drive_data(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.d[i], VX_OUTPUT);
        vx_pin_write(G.d[i], (v >> i) & 1);
    }
    G.driving = true;
}

static void release_data(void) {
    if (!G.driving) return;
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.d[i], VX_INPUT);
    G.driving = false;
}

static void update_outputs(void) {
    int ce_low = (vx_pin_read(G.ce) == 0);
    int oe_low = (vx_pin_read(G.oe) == 0);
    if (ce_low && oe_low) {
        drive_data(image_byte(read_addr()));
    } else {
        release_data();
    }
}

static void on_pin_change(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
    update_outputs();
}

void chip_setup(void) {
    char name[4];
    for (int i = 0; i < 15; i++) {
        name[0]='A';
        if (i<10) { name[1]='0'+i; name[2]=0; }
        else      { name[1]='1'; name[2]='0'+(i-10); name[3]=0; }
        G.a[i] = vx_pin_register(name, VX_INPUT);
    }
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.ce  = vx_pin_register("CE",  VX_INPUT);
    G.oe  = vx_pin_register("OE",  VX_INPUT);
    G.vcc = vx_pin_register("VCC", VX_INPUT);
    G.gnd = vx_pin_register("GND", VX_INPUT);
    G.driving = false;

    for (int i = 0; i < 15; i++) {
        vx_pin_watch(G.a[i], VX_EDGE_BOTH, on_pin_change, 0);
    }
    vx_pin_watch(G.ce, VX_EDGE_BOTH, on_pin_change, 0);
    vx_pin_watch(G.oe, VX_EDGE_BOTH, on_pin_change, 0);

    update_outputs();
}
