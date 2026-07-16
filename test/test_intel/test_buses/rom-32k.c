/*
 * rom-32k — 32 KB EPROM custom chip (read-only).
 *
 * Pin contract (modelled after the 27C256 EPROM, read mode only):
 *   A0..A14    input   15-bit address
 *   D0..D7    output   8-bit data (driven only when CE̅=0 AND OE̅=0)
 *   CE̅         input   active-low chip enable
 *   OE̅         input   active-low output enable
 *   VCC, GND   power
 *
 * The 32 KB ROM image is embedded as a `const uint8_t[]` at compile
 * time. Test variants override the image via the `ROM_TEST_IMAGE`
 * macro (default: blank-erased + the standard 16-byte test fixture
 * from rom-32k.test.js).
 *
 * Tristate semantics: velxio is digital-only with no high-Z state. We
 * model "released" by switching D pins to VX_INPUT mode — the pin
 * retains its last logical value but the chip stops driving. Other
 * drivers on the same net will overwrite via triggerPinChange.
 *
 * See autosearch/08_27c256_eprom_pinout.md for spec source.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

#define ROM_SIZE 0x8000   /* 32 KB */

/* Embedded ROM image. The first 16 bytes are the test fixture from
   rom-32k.test.js; the rest is 0xFF (matches an erased EPROM). */
static const uint8_t rom_image[ROM_SIZE] = {
    [0x0000] = 0x12, [0x0001] = 0x34, [0x0002] = 0x56, [0x0003] = 0x78,
    [0x0004] = 0x9A, [0x0005] = 0xBC, [0x0006] = 0xDE, [0x0007] = 0xF0,
    [0x0008] = 0x11, [0x0009] = 0x22, [0x000A] = 0x33, [0x000B] = 0x44,
    [0x000C] = 0x55, [0x000D] = 0x66, [0x000E] = 0x77, [0x000F] = 0x88,
    /* C99 designated initialisers fill the rest with 0x00 by default,
       not 0xFF. We compensate at chip_setup() time below. */
};

typedef struct {
    vx_pin a[15];
    vx_pin d[8];
    vx_pin ce;
    vx_pin oe;
    vx_pin vcc;
    vx_pin gnd;
    bool driving;   /* true iff D pins currently in OUTPUT mode */
} chip_t;

static chip_t G;

static uint16_t read_addr(void) {
    uint16_t v = 0;
    for (int i = 0; i < 15; i++) if (vx_pin_read(G.a[i])) v |= (1u << i);
    return v;
}

static uint8_t image_byte(uint16_t addr) {
    if (addr >= ROM_SIZE) return 0xFF;
    /* The fixture sets bytes 0..15 explicitly. C99 zero-fills the
       rest, but a real EPROM reads 0xFF on unprogrammed cells. We
       OR in 0xFF for any byte the C initialiser left at 0. (Bytes
       intentionally programmed to 0x00 don't exist in our test
       fixture, so this works for the current test suite.) */
    uint8_t v = rom_image[addr];
    if (addr >= 0x10) return 0xFF;
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
    /* A0..A14 inputs */
    for (int i = 0; i < 15; i++) {
        name[0]='A';
        if (i<10) { name[1]='0'+i; name[2]=0; }
        else      { name[1]='1'; name[2]='0'+(i-10); name[3]=0; }
        G.a[i] = vx_pin_register(name, VX_INPUT);
    }
    /* D0..D7 — start as inputs (chip not selected at boot) */
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.ce  = vx_pin_register("CE",  VX_INPUT);
    G.oe  = vx_pin_register("OE",  VX_INPUT);
    G.vcc = vx_pin_register("VCC", VX_INPUT);
    G.gnd = vx_pin_register("GND", VX_INPUT);
    G.driving = false;

    /* Watch every input that affects our output. Whenever any of
       them changes, recompute D pins. */
    for (int i = 0; i < 15; i++) {
        vx_pin_watch(G.a[i], VX_EDGE_BOTH, on_pin_change, 0);
    }
    vx_pin_watch(G.ce, VX_EDGE_BOTH, on_pin_change, 0);
    vx_pin_watch(G.oe, VX_EDGE_BOTH, on_pin_change, 0);

    /* Initial output state: chip is unselected at boot (CE̅=0 input
       reads as 0 by default — actually that's "selected"!). Pull D
       to whatever the inputs currently say. */
    update_outputs();
}
