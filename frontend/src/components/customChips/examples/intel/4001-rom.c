/*
 * Intel 4001 ROM — companion chip for the 4004/4040.
 *
 * 16-pin DIP, 256 bytes of mask-programmed ROM accessed over the
 * 4004's 4-bit multiplexed nibble bus, plus 4 I/O port lines that
 * the CPU can drive via WRR or read via RDR. Each 4001 has a hard-
 * coded 4-bit chip number (this implementation reads it from a
 * compile-time #define) and only responds when its number matches
 * the high nibble of the address driven during the A3 phase.
 *
 * Source: Intel MCS-4 User's Manual (Feb 1973), §V "4001 Read-Only
 * Memory" + Fig. 5-1 pin diagram.
 *
 * Pin contract (16 pins):
 *   D0..D3   I/O   shared multiplexed bus with the 4004
 *   SYNC     in    cycle marker driven by the 4004 (high during A1)
 *   CL       in    Φ2 clock — informational; we use our own timer
 *   RESET    in    asynchronous reset
 *   CM       in    chip-match strobe (= 4004's CM-ROM during M1/M2)
 *   I0..I3   I/O   4 I/O port lines (drivable via WRR, readable via RDR)
 *   VDD, VSS power
 *
 * Timing model — the trickiest part. The 4004 walks an 8-phase frame
 * (A1, A2, A3, M1, M2, X1, X2, X3) at one phase per timer fire. The
 * 4001 must:
 *   - capture the 12-bit PC nibble-by-nibble during A1, A2, A3
 *   - drive the opcode high nibble during M1
 *   - drive the opcode low nibble during M2
 *
 * BoardHarness fires chips' timers in REGISTRATION order. We rely
 * on the 4001 being registered BEFORE the 4004 (caller's
 * responsibility), so the 4001 fires first each advanceNanos. Even
 * so, the 4001's actions are ONE FRAME behind the 4004's drives —
 * because in the same advanceNanos, the 4001 fires *before* the
 * 4004 drives the bus for that phase. A simple state machine handles
 * this offset:
 *
 *   advanceNanos N | 4004 will drive  | 4001 (which fires first) does
 *   ---------------|------------------|----------------------------------
 *   1              | A1: PC[3:0]      | (idle, no SYNC seen)
 *   2              | A2: PC[7:4]      | sample D = PC[3:0]  (from frame 1)
 *   3              | A3: PC[11:8]     | sample D = PC[7:4]
 *   4              | M1: read opcode  | sample D = PC[11:8]; addr complete;
 *                  |                  | drive D = opcode_hi (4004's M1 read
 *                  |                  | fires next, sees our drive)
 *   5              | M2: read opcode  | drive D = opcode_lo
 *   6..8           | X1..X3 (idle)    | idle
 *   (next SYNC) → state resets to start.
 *
 * This file ships a fixture ROM image: 16 known bytes at offsets 0..15
 * for tests, plus 0x00 (= NOP) elsewhere.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

#ifndef ROM4001_CHIP_ID
#define ROM4001_CHIP_ID 0   /* selected by 12-bit address bits 11..8 */
#endif

#define ROM_SIZE 256

typedef enum {
    S_IDLE = 0,         /* before any SYNC */
    S_SAMPLE_LOW,       /* about to sample addr_low (A1's drive from prev frame) */
    S_SAMPLE_MID,
    S_SAMPLE_HIGH,
    S_DRIVE_HI,         /* about to drive opcode_hi (4004's next phase is M1) */
    S_DRIVE_LO,
    S_POST,             /* X1..X3, no action */
} state_t;

typedef struct {
    vx_pin d[4];
    vx_pin sync;
    vx_pin cl;
    vx_pin reset_;
    vx_pin cm;
    vx_pin io[4];
    vx_pin vdd, vss;

    vx_timer phase_timer;

    uint8_t  rom[ROM_SIZE];
    state_t  state;
    uint8_t  addr_low;
    uint8_t  addr_mid;
    uint8_t  addr_high;
    uint8_t  io_latch;
    bool     driving_d;
} chip_t;

static chip_t G;

/* ─── D-bus helpers ─────────────────────────────────────────────────────── */
static uint8_t read_d_nibble(void) {
    uint8_t v = 0;
    for (int i = 0; i < 4; i++) if (vx_pin_read(G.d[i])) v |= (1u << i);
    return v;
}
static void drive_d_nibble(uint8_t n) {
    for (int i = 0; i < 4; i++) {
        vx_pin_set_mode(G.d[i], VX_OUTPUT);
        vx_pin_write(G.d[i], (n >> i) & 1);
    }
    G.driving_d = true;
}
static void release_d(void) {
    if (!G.driving_d) return;
    for (int i = 0; i < 4; i++) vx_pin_set_mode(G.d[i], VX_INPUT);
    G.driving_d = false;
}

/* ─── Phase-tracking timer ──────────────────────────────────────────────── */
static void on_phase(void* user_data) {
    (void)user_data;
    switch (G.state) {
        case S_IDLE:
            release_d();
            break;
        case S_SAMPLE_LOW:
            G.addr_low = read_d_nibble() & 0xF;
            G.state = S_SAMPLE_MID;
            break;
        case S_SAMPLE_MID:
            G.addr_mid = read_d_nibble() & 0xF;
            G.state = S_SAMPLE_HIGH;
            break;
        case S_SAMPLE_HIGH:
            G.addr_high = read_d_nibble() & 0xF;
            G.state = S_DRIVE_HI;
            /* fall through — drive opcode_hi NOW so 4004's M1 read sees it */
            __attribute__((fallthrough));
        case S_DRIVE_HI:
            if (G.addr_high == ROM4001_CHIP_ID) {
                uint8_t addr8 = (uint8_t)((G.addr_mid << 4) | G.addr_low);
                drive_d_nibble((G.rom[addr8] >> 4) & 0xF);
            } else {
                release_d();
            }
            G.state = S_DRIVE_LO;
            break;
        case S_DRIVE_LO:
            if (G.addr_high == ROM4001_CHIP_ID) {
                uint8_t addr8 = (uint8_t)((G.addr_mid << 4) | G.addr_low);
                drive_d_nibble(G.rom[addr8] & 0xF);
            } else {
                release_d();
            }
            G.state = S_POST;
            break;
        case S_POST:
            release_d();
            /* stay here until next SYNC */
            break;
    }
}

/* SYNC rising: 4004 just entered A1 phase. Reset state machine to start
   sampling on the next tick. (4001 drove SYNC's previous-frame drives
   into our state already on prior fires.) */
static void on_sync(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) {
        G.state = S_SAMPLE_LOW;
    }
}

static void on_reset(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) {
        G.state = S_IDLE;
        release_d();
    }
}

/* CM strobe (CM-ROM): not strictly required for our model since we
   already track phases via SYNC + timer. Ignored. */
static void on_cm(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
}

void chip_setup(void) {
    char name[6];

    for (int i = 0; i < 4; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    G.sync   = vx_pin_register("SYNC",  VX_INPUT);
    G.cl     = vx_pin_register("CL",    VX_INPUT);
    G.reset_ = vx_pin_register("RESET", VX_INPUT);
    G.cm     = vx_pin_register("CM",    VX_INPUT);
    for (int i = 0; i < 4; i++) {
        name[0]='I'; name[1]='O'; name[2]='0'+i; name[3]=0;
        G.io[i] = vx_pin_register(name, VX_INPUT);
    }
    G.vdd    = vx_pin_register("VDD",   VX_INPUT);
    G.vss    = vx_pin_register("VSS",   VX_INPUT);

    /* Test fixture: 16 known bytes at offset 0, rest zeros (NOP). */
    memset(G.rom, 0, ROM_SIZE);
    G.rom[0]  = 0x12; G.rom[1]  = 0x34; G.rom[2]  = 0x56; G.rom[3]  = 0x78;
    G.rom[4]  = 0x9A; G.rom[5]  = 0xBC; G.rom[6]  = 0xDE; G.rom[7]  = 0xF0;
    G.rom[8]  = 0x11; G.rom[9]  = 0x22; G.rom[10] = 0x33; G.rom[11] = 0x44;
    G.rom[12] = 0x55; G.rom[13] = 0x66; G.rom[14] = 0x77; G.rom[15] = 0x88;

    G.state = S_IDLE;
    G.driving_d = false;
    G.io_latch = 0;

    vx_pin_watch(G.sync,   VX_EDGE_RISING, on_sync,  0);
    vx_pin_watch(G.reset_, VX_EDGE_RISING, on_reset, 0);
    vx_pin_watch(G.cm,     VX_EDGE_BOTH,   on_cm,    0);

    /* Same period as 4004 (1351 ns). Caller registers 4001 BEFORE
       4004 so our timer fires first per advanceNanos — the 4001 then
       drives D pins before the 4004 reads. */
    G.phase_timer = vx_timer_create(on_phase, 0);
    vx_timer_start(G.phase_timer, 1351, true);
}
