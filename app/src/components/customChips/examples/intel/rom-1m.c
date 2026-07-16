/*
 * rom-1m — top-of-1MB ROM custom chip for the 8086.
 *
 * Naming is historical; the chip is actually a 64 KB ROM mapped at
 * physical addresses 0xF0000..0xFFFFF — the upper 64 KB of the 8086's
 * 1 MiB address space, which is where real-world PC BIOSes sit. This
 * fits within the WASM 1 MiB linear-memory cap with room for the chip's
 * other state.
 *
 * The chip listens on the full 20-bit address bus (A0..A19); when the
 * upper 4 address bits are not 0xF, the chip releases the data bus
 * (out-of-range — let another chip drive). Reset vector 0xFFFF0 maps
 * to image offset 0xFFF0.
 *
 * Pin contract:
 *   A0..A19   input    20-bit address
 *   D0..D7   output    8-bit data (driven only when CE̅=0 AND OE̅=0
 *                       AND addr is in [0xF0000..0xFFFFF])
 *   CE̅        input    active-low chip enable
 *   OE̅        input    active-low output enable
 *   VCC, GND  power
 *
 * Image is allocated via malloc at chip_setup. A small known signature
 * is patched at the reset vector for tests to verify ROM presence.
 *
 * For per-demo ROM contents, a follow-up SDK extension (blob attribute)
 * would let users upload arbitrary boot images. For now each "ROM
 * image" is a separately compiled chip variant.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define ROM_BASE   0xF0000
#define ROM_SIZE   0x10000   /* 64 KB */
#define ROM_END    (ROM_BASE + ROM_SIZE)

typedef struct {
    vx_pin a[20];
    vx_pin d[8];
    vx_pin ce;
    vx_pin oe;
    vx_pin vcc, gnd;
    uint8_t* image;
    bool driving;
} chip_t;

static chip_t G;

static uint32_t read_addr(void) {
    uint32_t v = 0;
    for (int i = 0; i < 20; i++) if (vx_pin_read(G.a[i])) v |= (1u << i);
    return v;
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

static void update(void) {
    int ce_low = (vx_pin_read(G.ce) == 0);
    int oe_low = (vx_pin_read(G.oe) == 0);
    if (!ce_low || !oe_low) { release_data(); return; }
    uint32_t addr = read_addr();
    if (addr < ROM_BASE || addr >= ROM_END) { release_data(); return; }
    drive_data(G.image[addr - ROM_BASE]);
}

static void on_pin_change(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
    update();
}

void chip_setup(void) {
    char name[5];
    for (int i = 0; i < 20; i++) {
        if (i < 10) {
            name[0]='A'; name[1]='0'+i; name[2]=0;
        } else {
            name[0]='A'; name[1]='1'; name[2]='0'+(i-10); name[3]=0;
        }
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

    G.image = (uint8_t*)malloc(ROM_SIZE);
    memset(G.image, 0xFF, ROM_SIZE);
    /* Test fixture: 16-byte signature at the reset vector 0xFFFF0,
       which maps to image offset 0xFFF0. */
    static const uint8_t reset_signature[16] = {
        0xEA, 0x00, 0x01, 0x00, 0xF0,   /* JMP FAR 0xF000:0x0100 */
        0x55, 0xAA, 0x12, 0x34,
        0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x77,
    };
    memcpy(&G.image[0xFFF0], reset_signature, sizeof reset_signature);

    G.driving = false;

    for (int i = 0; i < 20; i++) {
        vx_pin_watch(G.a[i], VX_EDGE_BOTH, on_pin_change, 0);
    }
    vx_pin_watch(G.ce, VX_EDGE_BOTH, on_pin_change, 0);
    vx_pin_watch(G.oe, VX_EDGE_BOTH, on_pin_change, 0);

    update();
}
