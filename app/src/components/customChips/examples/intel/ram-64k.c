/*
 * ram-64k — 64 KB SRAM custom chip.
 *
 * Pin contract (idealised 64 KB byte-wide SRAM, see autosearch/09):
 *   A0..A15    input         16-bit address
 *   D0..D7    bidirectional  8-bit data (output on read, input on write)
 *   CE̅         input          active-low chip enable
 *   OE̅         input          active-low output enable
 *   WE̅         input          active-low write enable (latch on rising edge)
 *   VCC, GND   power
 *
 * Read mode: CE̅=0 AND OE̅=0 AND WE̅=1 → drive D pins from mem[addr].
 * Write mode: CE̅=0 AND WE̅ rising edge (with data already on D pins) →
 *             latch mem[addr] := data.
 * Standby: CE̅=1 → D pins released.
 *
 * The 64 KB array is zero-initialised at chip_setup. Real SRAM powers
 * up indeterminate; zero-init is a deliberate simplification that
 * matches every common simulator (Wokwi, etc.) and is what
 * ram-64k.test.js's blank-state assertion expects.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define RAM_SIZE 0x10000   /* 64 KB */

/* mem[] is malloc'd at chip_setup, NOT a static array, so the linker
   doesn't include 64 KB of BSS in the chip's initial memory image.
   The host (ChipRuntime.ts) provides 2 pages = 128 KB initial and
   permits growth up to 16 pages = 1 MB, more than enough for 64 KB
   on the heap plus stack. */
typedef struct {
    vx_pin a[16];
    vx_pin d[8];
    vx_pin ce;
    vx_pin oe;
    vx_pin we;
    vx_pin vcc;
    vx_pin gnd;
    uint8_t* mem;
    bool driving;
    int we_last;
} chip_t;

static chip_t G;

static uint16_t read_addr(void) {
    uint16_t v = 0;
    for (int i = 0; i < 16; i++) if (vx_pin_read(G.a[i])) v |= (1u << i);
    return v;
}

static uint8_t read_data_bus(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.d[i])) v |= (1u << i);
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
    int we_low = (vx_pin_read(G.we) == 0);
    /* Drive only on a true read: selected, output enabled, not writing. */
    if (ce_low && oe_low && !we_low) {
        drive_data(G.mem[read_addr()]);
    } else {
        release_data();
    }
}

static void on_addr_or_ctrl(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
    update_outputs();
}

static void on_we(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    int ce_low = (vx_pin_read(G.ce) == 0);
    /* Latch on rising edge of WE̅ when chip is selected.
       (Pin watch was registered for EDGE_BOTH so we detect both
       transitions; rising means we_last==0 and value==1.) */
    if (G.we_last == 0 && value == 1 && ce_low) {
        uint16_t addr = read_addr();
        uint8_t  data = read_data_bus();
        G.mem[addr] = data;
    }
    G.we_last = value;
    /* WE̅ change also affects whether we should be driving D in read
       mode (during write, we must release). */
    update_outputs();
}

void chip_setup(void) {
    char name[4];

    /* A0..A15 inputs */
    for (int i = 0; i < 16; i++) {
        name[0]='A';
        if (i<10) { name[1]='0'+i; name[2]=0; }
        else      { name[1]='1'; name[2]='0'+(i-10); name[3]=0; }
        G.a[i] = vx_pin_register(name, VX_INPUT);
    }
    /* D0..D7 inputs (bidirectional; we switch to OUTPUT during reads) */
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.ce  = vx_pin_register("CE",  VX_INPUT);
    G.oe  = vx_pin_register("OE",  VX_INPUT);
    G.we  = vx_pin_register("WE",  VX_INPUT);
    G.vcc = vx_pin_register("VCC", VX_INPUT);
    G.gnd = vx_pin_register("GND", VX_INPUT);

    G.mem = (uint8_t*)calloc(RAM_SIZE, 1);
    G.driving = false;
    G.we_last = vx_pin_read(G.we);   /* sample initial WE̅ level */

    /* Watches: address and CE/OE affect outputs; WE is special because
       its rising edge is the write-latch trigger. */
    for (int i = 0; i < 16; i++) {
        vx_pin_watch(G.a[i], VX_EDGE_BOTH, on_addr_or_ctrl, 0);
    }
    vx_pin_watch(G.ce, VX_EDGE_BOTH, on_addr_or_ctrl, 0);
    vx_pin_watch(G.oe, VX_EDGE_BOTH, on_addr_or_ctrl, 0);
    vx_pin_watch(G.we, VX_EDGE_BOTH, on_we, 0);

    update_outputs();
}
