/*
 * z80-ram-rom — a rom-32k variant whose image is a Z80 RAM round-trip test,
 * for the Phase 3 computer-core proof (project/multichip-bus/). Honours the
 * full image (no 0xFF clamp) so the program can exceed 16 bytes.
 *
 *   0000: 3E 5A        LD A, 0x5A
 *   0002: 32 00 80     LD (0x8000), A     ; write 0x5A to RAM at 0x8000
 *   0005: AF           XOR A              ; A = 0
 *   0006: 3A 00 80     LD A, (0x8000)     ; read it back from RAM
 *   0009: FE 5A        CP 0x5A
 *   000B: C2 10 00     JP NZ, 0x0010      ; mismatch -> fail loop (no HALT)
 *   000E: 76           HALT               ; success: RAM round-trip worked
 *   0010: C3 10 00     JP 0x0010          ; fail: spin forever
 *
 * HALT only fires if the Z80 fetched the program from ROM (0x0000-0x7FFF),
 * wrote+read RAM (0x8000-0xFFFF), and the byte survived — i.e. address decoding
 * + RAM read/write over the shared bus all work.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

#define ROM_SIZE 0x8000   /* 32 KB */

static const uint8_t rom_image[ROM_SIZE] = {
    [0x0000] = 0x3E, [0x0001] = 0x5A,
    [0x0002] = 0x32, [0x0003] = 0x00, [0x0004] = 0x80,
    [0x0005] = 0xAF,
    [0x0006] = 0x3A, [0x0007] = 0x00, [0x0008] = 0x80,
    [0x0009] = 0xFE, [0x000A] = 0x5A,
    [0x000B] = 0xC2, [0x000C] = 0x10, [0x000D] = 0x00,
    [0x000E] = 0x76,
    [0x0010] = 0xC3, [0x0011] = 0x10, [0x0012] = 0x00,
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
    return rom_image[addr]; /* honour the whole image; unset = 0x00 (NOP) */
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
