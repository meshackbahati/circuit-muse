/*
 * i8080-counter.c — bundled "Intel 8080 button counter" custom chip.
 *
 * Same 8080 emulator core as i8080-repl.c, but its memory-mapped I/O is
 * shaped for visual demos:
 *   - 8 LED output pins (LED0..LED7) reflect a byte the CPU writes at 0x2000
 *   - 2 button input pins (BTN_INC, BTN_RST) — rising edges set bits in
 *     a latch register at 0x2003. Reading 0x2003 returns and clears the
 *     latch, giving the 8080 program a clean edge-trigger.
 *
 * The embedded ROM increments a counter on each press of BTN_INC, resets
 * it on each press of BTN_RST, and writes the current value to the LED
 * port every iteration. Wire the LEDs and buttons up on the canvas and
 * the chip behaves like a tiny stand-alone counter board.
 *
 * Memory map:
 *   0x0000..0x0021  ROM (34 bytes, assembled from scripts/counter-rom.s)
 *   0x1000..0x10FF  RAM (256 bytes — stack only)
 *   0x2000          LED_OUT     (write → drives LED0..LED7)
 *   0x2002          BTN_IN      (read → live button bitmap)
 *   0x2003          EDGE_FLAGS  (read → rising-edge latch since last read)
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

static const uint8_t ROM[] = {
    /* Assembled from scripts/counter-rom.s — 34 bytes. */
    0x31, 0xff, 0x10, 0x0e, 0x00, 0x79, 0x32, 0x00, 0x20, 0x3a, 0x03, 0x20,
    0x47, 0xe6, 0x01, 0xca, 0x13, 0x00, 0x0c, 0x78, 0xe6, 0x02, 0xca, 0x1b,
    0x00, 0x0e, 0x00, 0x79, 0x32, 0x00, 0x20, 0xc3, 0x09, 0x00,
};

#define ROM_SIZE (sizeof(ROM))
#define RAM_BASE 0x1000
#define RAM_SIZE 0x0100

#define MMIO_LED_OUT    0x2000
#define MMIO_BTN_IN     0x2002
#define MMIO_EDGE_FLAGS 0x2003

static uint8_t RAM_buf[RAM_SIZE];

/* ─── Pins ────────────────────────────────────────────────────────────── */
static vx_pin g_led[8];
static vx_pin g_btn_inc;
static vx_pin g_btn_rst;
/* Latched rising-edge flags: bit0 = INC, bit1 = RST. Cleared on read. */
static volatile uint8_t edge_latch = 0;

static void on_btn_inc_rising(void* ud, vx_pin pin, int value) {
    (void)ud; (void)pin; (void)value;
    edge_latch |= 0x01;
}
static void on_btn_rst_rising(void* ud, vx_pin pin, int value) {
    (void)ud; (void)pin; (void)value;
    edge_latch |= 0x02;
}

static uint8_t read_btn_bitmap(void) {
    uint8_t b = 0;
    if (vx_pin_read(g_btn_inc)) b |= 0x01;
    if (vx_pin_read(g_btn_rst)) b |= 0x02;
    return b;
}

static void drive_leds(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_write(g_led[i], (v >> i) & 1);
    }
}

/* ─── 8080 core (same shape as i8080-repl.c — abridged to the ops the
 *    counter ROM actually uses, so the chip stays small. Anything missing
 *    is treated as NOP. Full ISA lives in i8080-repl.c if you need more.) ─ */
#define F_S    0x80
#define F_Z    0x40
#define F_AC   0x10
#define F_P    0x04
#define F_RES1 0x02
#define F_CY   0x01

typedef struct {
    union { struct { uint8_t c, b; }; uint16_t bc; };
    union { struct { uint8_t e, d; }; uint16_t de; };
    union { struct { uint8_t l, h; }; uint16_t hl; };
    uint16_t sp; uint16_t pc;
    uint8_t  acc;
    bool fs, fz, fac, fp, fcy;
    bool halted;
} cpu_t;
static cpu_t G;

static uint8_t mem_read(uint16_t a);
static void mem_write(uint16_t a, uint8_t v);

static uint8_t fetch8(void)  { return mem_read(G.pc++); }
static uint8_t imm8(void)    { return mem_read(G.pc++); }
static uint16_t imm16(void)  { uint16_t lo = imm8(); return lo | ((uint16_t)imm8() << 8); }

static void stack_push(uint8_t v) { G.sp--; mem_write(G.sp, v); }
static uint8_t stack_pop(void)    { uint8_t v = mem_read(G.sp); G.sp++; return v; }
static void push16(uint16_t v) { stack_push(v >> 8); stack_push(v & 0xff); }
static uint16_t pop16(void) { uint8_t lo = stack_pop(); uint8_t hi = stack_pop(); return lo | ((uint16_t)hi << 8); }

static bool parity8(uint8_t v) {
    v ^= v >> 4; v ^= v >> 2; v ^= v >> 1;
    return (v & 1) == 0;
}
static void set_szp(uint8_t v) {
    G.fs = (v & 0x80) != 0;
    G.fz = v == 0;
    G.fp = parity8(v);
}

static uint8_t reg_read_code(uint8_t code) {
    switch (code & 7) {
        case 0: return G.b; case 1: return G.c;
        case 2: return G.d; case 3: return G.e;
        case 4: return G.h; case 5: return G.l;
        case 6: return mem_read(G.hl);
        default: return G.acc;
    }
}
static void reg_write_code(uint8_t code, uint8_t v) {
    switch (code & 7) {
        case 0: G.b = v; break; case 1: G.c = v; break;
        case 2: G.d = v; break; case 3: G.e = v; break;
        case 4: G.h = v; break; case 5: G.l = v; break;
        case 6: mem_write(G.hl, v); break;
        default: G.acc = v; break;
    }
}

static void alu_add(uint8_t v) {
    uint16_t r = (uint16_t)G.acc + v;
    G.fac = (((G.acc & 0x0F) + (v & 0x0F)) & 0x10) != 0;
    G.fcy = (r & 0x100) != 0;
    G.acc = (uint8_t)r; set_szp(G.acc);
}
static void alu_and(uint8_t v) {
    G.fac = ((G.acc | v) & 0x08) != 0;
    G.acc &= v; G.fcy = false;
    set_szp(G.acc);
}
static void alu_or(uint8_t v) {
    G.acc |= v; G.fcy = false; G.fac = false;
    set_szp(G.acc);
}
static void alu_xor(uint8_t v) {
    G.acc ^= v; G.fcy = false; G.fac = false;
    set_szp(G.acc);
}
static void alu_cmp(uint8_t v) {
    uint16_t r = (uint16_t)G.acc - v;
    G.fac = (((G.acc & 0x0F) - (v & 0x0F)) & 0x10) == 0;
    G.fcy = (r & 0x100) != 0;
    set_szp((uint8_t)r);
}
static void alu_sub(uint8_t v) {
    uint16_t r = (uint16_t)G.acc - v;
    G.fac = (((G.acc & 0x0F) - (v & 0x0F)) & 0x10) == 0;
    G.fcy = (r & 0x100) != 0;
    G.acc = (uint8_t)r; set_szp(G.acc);
}

static uint8_t inr(uint8_t v) {
    uint8_t r = v + 1; G.fac = (v & 0x0F) == 0x0F;
    set_szp(r); return r;
}
static uint8_t dcr(uint8_t v) {
    uint8_t r = v - 1; G.fac = (v & 0x0F) != 0;
    set_szp(r); return r;
}

static bool cond_met(uint8_t cc) {
    switch (cc & 7) {
        case 0: return !G.fz; case 1: return  G.fz;
        case 2: return !G.fcy; case 3: return  G.fcy;
        case 4: return !G.fp; case 5: return  G.fp;
        case 6: return !G.fs; case 7: return  G.fs;
    }
    return false;
}

static void step(void) {
    if (G.halted) return;
    uint8_t op = fetch8();

    if ((op & 0xC0) == 0x40) {
        if (op == 0x76) { G.halted = true; return; }
        reg_write_code(op >> 3, reg_read_code(op));
        return;
    }
    if ((op & 0xC7) == 0x06) { reg_write_code(op >> 3, imm8()); return; }
    if ((op & 0xC7) == 0x04) { uint8_t c = (op >> 3) & 7; reg_write_code(c, inr(reg_read_code(c))); return; }
    if ((op & 0xC7) == 0x05) { uint8_t c = (op >> 3) & 7; reg_write_code(c, dcr(reg_read_code(c))); return; }
    if ((op & 0xC0) == 0x80) {
        uint8_t alu_idx = (op >> 3) & 7;
        uint8_t v = reg_read_code(op);
        switch (alu_idx) {
            case 0: alu_add(v); break;
            case 2: alu_sub(v); break;
            case 4: alu_and(v); break;
            case 5: alu_xor(v); break;
            case 6: alu_or (v); break;
            case 7: alu_cmp(v); break;
            default: break;
        }
        return;
    }
    if ((op & 0xC7) == 0xC2) { uint16_t a = imm16(); if (cond_met((op >> 3) & 7)) G.pc = a; return; }
    if ((op & 0xC7) == 0xC4) { uint16_t a = imm16(); if (cond_met((op >> 3) & 7)) { push16(G.pc); G.pc = a; } return; }
    if ((op & 0xC7) == 0xC0) { if (cond_met((op >> 3) & 7)) G.pc = pop16(); return; }

    switch (op) {
        case 0x00: break;
        case 0x01: G.bc = imm16(); break;
        case 0x11: G.de = imm16(); break;
        case 0x21: G.hl = imm16(); break;
        case 0x31: G.sp = imm16(); break;
        case 0x32: { uint16_t a = imm16(); mem_write(a, G.acc); break; }
        case 0x3A: { uint16_t a = imm16(); G.acc = mem_read(a); break; }
        case 0xC6: alu_add(imm8()); break;
        case 0xD6: alu_sub(imm8()); break;
        case 0xE6: alu_and(imm8()); break;
        case 0xEE: alu_xor(imm8()); break;
        case 0xF6: alu_or (imm8()); break;
        case 0xFE: alu_cmp(imm8()); break;
        case 0xC3: G.pc = imm16(); break;
        case 0xCD: { uint16_t a = imm16(); push16(G.pc); G.pc = a; break; }
        case 0xC9: G.pc = pop16(); break;
        default: break;
    }
}

static uint8_t mem_read(uint16_t a) {
    if (a < ROM_SIZE) return ROM[a];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) return RAM_buf[a - RAM_BASE];
    if (a == MMIO_BTN_IN) return read_btn_bitmap();
    if (a == MMIO_EDGE_FLAGS) {
        uint8_t v = edge_latch; edge_latch = 0;
        return v;
    }
    return 0xFF;
}

static void mem_write(uint16_t a, uint8_t v) {
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
        RAM_buf[a - RAM_BASE] = v; return;
    }
    if (a == MMIO_LED_OUT) {
        drive_leds(v);
        return;
    }
}

static vx_timer g_timer;

static void on_clock(void* ud) {
    (void)ud;
    /* The button-counter program is tiny — 11 instructions per loop —
       so we don't need a high IPS. Run 200 instructions per 1 ms tick
       (200 KIPS) — plenty of responsiveness without burning CPU. */
    for (int i = 0; i < 200; i++) step();
}

void chip_setup(void) {
    char name[8];
    for (int i = 0; i < 8; i++) {
        name[0] = 'L'; name[1] = 'E'; name[2] = 'D';
        name[3] = '0' + i; name[4] = 0;
        g_led[i] = vx_pin_register(name, VX_OUTPUT_LOW);
    }
    g_btn_inc = vx_pin_register("BTN_INC", VX_INPUT_PULLDOWN);
    g_btn_rst = vx_pin_register("BTN_RST", VX_INPUT_PULLDOWN);
    vx_pin_register("VCC", VX_INPUT);
    vx_pin_register("GND", VX_INPUT);

    vx_pin_watch(g_btn_inc, VX_EDGE_RISING, on_btn_inc_rising, 0);
    vx_pin_watch(g_btn_rst, VX_EDGE_RISING, on_btn_rst_rising, 0);

    G.pc = 0; G.sp = 0; G.acc = 0;
    G.b = G.c = G.d = G.e = G.h = G.l = 0;
    G.fs = G.fz = G.fac = G.fp = false; G.fcy = false;
    G.halted = false;

    g_timer = vx_timer_create(on_clock, 0);
    vx_timer_start(g_timer, 1000000, true);   /* 1 ms tick */

    vx_log("i8080-counter ready (34-byte ROM)");
}
