/*
 * i8080-repl.c — bundled "Intel 8080 mini-computer" custom chip.
 *
 * One self-contained WASM module that emulates the Intel 8080A executing
 * a small program out of an internal ROM, with internal RAM, and a
 * memory-mapped UART exposed via Velxio's vx_uart_attach. Drop this onto
 * the canvas, wire the UART TX/RX pins, and the Serial Monitor shows the
 * chip's TX bytes after the host AVR sketch echoes them.
 *
 * The CPU semantics are the same clean-room implementation validated by
 * test/test_intel/test_8080/8080.test.js (which runs Microcosm's 1980
 * CPUDIAG to "CPU IS OPERATIONAL"). The bus protocol from the standalone
 * chip is collapsed to direct memory accesses here — the embedded RAM /
 * ROM / MMIO live inside this WASM, not on external pins.
 *
 * Memory map:
 *   0x0000..0x015F  ROM (the program)
 *   0x1000..0x10FF  RAM
 *   0x2000          UART_DATA  (read RX byte / write TX byte)
 *   0x2001          UART_STAT  (bit 0 = TX always ready, bit 1 = RX has byte)
 *
 * The program (assembled by scripts/asm8080.py from scripts/repl-rom.s)
 * prints a banner and then loops printing "uptime ticks: NN" every ~50 ms
 * with a real DCR/JNZ busy-wait — a clear visual proof that the 8080
 * core is executing real instructions.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

/* ─── Embedded ROM ─────────────────────────────────────────────────────── */
static const uint8_t ROM[] = {
    /* Assembled from scripts/repl-rom.s — 328 bytes. */
    0x31, 0xff, 0x10, 0x21, 0x72, 0x00, 0xcd, 0x45, 0x00, 0x3e, 0x00, 0x32,
    0x00, 0x10, 0x21, 0x35, 0x01, 0xcd, 0x45, 0x00, 0x3a, 0x00, 0x10, 0xcd,
    0x50, 0x00, 0x3e, 0x0d, 0xcd, 0x41, 0x00, 0x3e, 0x0a, 0xcd, 0x41, 0x00,
    0x3a, 0x00, 0x10, 0x3c, 0x32, 0x00, 0x10, 0xcd, 0x31, 0x00, 0xc3, 0x0e,
    0x00, 0x21, 0x00, 0x02, 0x06, 0x64, 0x05, 0xc2, 0x36, 0x00, 0x2b, 0x7c,
    0xb5, 0xc2, 0x34, 0x00, 0xc9, 0x32, 0x00, 0x20, 0xc9, 0x7e, 0xfe, 0x00,
    0xc8, 0xcd, 0x41, 0x00, 0x23, 0xc3, 0x45, 0x00, 0x4f, 0x0f, 0x0f, 0x0f,
    0x0f, 0xe6, 0x0f, 0xcd, 0x61, 0x00, 0x79, 0xe6, 0x0f, 0xcd, 0x61, 0x00,
    0xc9, 0xfe, 0x0a, 0xda, 0x6c, 0x00, 0xc6, 0x37, 0xcd, 0x41, 0x00, 0xc9,
    0xc6, 0x30, 0xcd, 0x41, 0x00, 0xc9, 0x0d, 0x0a, 0x20, 0x20, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x0d, 0x0a, 0x20, 0x20, 0x20, 0x76, 0x65,
    0x6c, 0x78, 0x69, 0x6f, 0x20, 0x69, 0x38, 0x30, 0x38, 0x30, 0x20, 0x2d,
    0x20, 0x63, 0x6c, 0x65, 0x61, 0x6e, 0x2d, 0x72, 0x6f, 0x6f, 0x6d, 0x20,
    0x49, 0x6e, 0x74, 0x65, 0x6c, 0x20, 0x38, 0x30, 0x38, 0x30, 0x41, 0x20,
    0x69, 0x6e, 0x20, 0x57, 0x41, 0x53, 0x4d, 0x0d, 0x0a, 0x20, 0x20, 0x20,
    0x42, 0x6f, 0x6f, 0x74, 0x65, 0x64, 0x20, 0x66, 0x72, 0x6f, 0x6d, 0x20,
    0x61, 0x20, 0x32, 0x30, 0x30, 0x2d, 0x62, 0x79, 0x74, 0x65, 0x20, 0x65,
    0x6d, 0x62, 0x65, 0x64, 0x64, 0x65, 0x64, 0x20, 0x52, 0x4f, 0x4d, 0x20,
    0x69, 0x6d, 0x61, 0x67, 0x65, 0x0d, 0x0a, 0x20, 0x20, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d, 0x3d,
    0x3d, 0x3d, 0x3d, 0x3d, 0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x20, 0x20, 0x75,
    0x70, 0x74, 0x69, 0x6d, 0x65, 0x20, 0x74, 0x69, 0x63, 0x6b, 0x73, 0x3a,
    0x20, 0x30, 0x78, 0x00,
};

#define ROM_SIZE (sizeof(ROM))
#define ROM_BASE 0x0000
#define RAM_BASE 0x1000
#define RAM_SIZE 0x0100      /* 256 bytes is plenty for stack + scratch */
#define MMIO_BASE 0x2000

#define MMIO_UART_DATA 0x2000
#define MMIO_UART_STAT 0x2001

static uint8_t RAM_buf[RAM_SIZE];

/* ─── UART RX queue ────────────────────────────────────────────────────── */
#define RX_BUFSZ 64
static uint8_t rx_buf[RX_BUFSZ];
static volatile uint32_t rx_head = 0, rx_tail = 0;

static bool rx_has(void) { return rx_head != rx_tail; }

static uint8_t rx_pop(void) {
    if (rx_head == rx_tail) return 0;
    uint8_t v = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) % RX_BUFSZ;
    return v;
}

static void rx_push(uint8_t b) {
    uint32_t next = (rx_head + 1) % RX_BUFSZ;
    if (next == rx_tail) return;        /* overflow — drop */
    rx_buf[rx_head] = b;
    rx_head = next;
}

/* ─── 8080 state (clean-room — same shape as test_intel/test_8080/8080.c) ─ */
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
    uint16_t sp;
    uint16_t pc;
    uint8_t  acc;
    bool fs, fz, fac, fp, fcy;
    bool halted;
    bool ime;
} cpu_t;

static cpu_t G;
static vx_uart g_uart;
static vx_timer g_timer;

/* ─── Memory + MMIO ───────────────────────────────────────────────────── */
static uint8_t mem_read(uint16_t addr) {
    if (addr < ROM_SIZE) return ROM[addr];
    if (addr >= RAM_BASE && addr < RAM_BASE + RAM_SIZE)
        return RAM_buf[addr - RAM_BASE];
    if (addr == MMIO_UART_DATA) {
        return rx_has() ? rx_pop() : 0;
    }
    if (addr == MMIO_UART_STAT) {
        uint8_t s = 0x01;                  /* TX always ready */
        if (rx_has()) s |= 0x02;
        return s;
    }
    return 0xFF;
}

static void mem_write(uint16_t addr, uint8_t v) {
    if (addr >= RAM_BASE && addr < RAM_BASE + RAM_SIZE) {
        RAM_buf[addr - RAM_BASE] = v;
        return;
    }
    if (addr == MMIO_UART_DATA) {
        vx_uart_write(g_uart, &v, 1);
        return;
    }
    /* ROM and unmapped writes are silently dropped — matches typical
       8080 minimum-board behaviour where /WR̅ is gated by /RAM_CS̅. */
}

static uint8_t fetch8(void)  { return mem_read(G.pc++); }
static uint8_t imm8(void)    { return mem_read(G.pc++); }
static uint16_t imm16(void)  { uint16_t lo = imm8(); return lo | ((uint16_t)imm8() << 8); }

static void stack_push(uint8_t v) { G.sp--; mem_write(G.sp, v); }
static uint8_t stack_pop(void)    { uint8_t v = mem_read(G.sp); G.sp++; return v; }
static void push16(uint16_t v) { stack_push(v >> 8); stack_push(v & 0xff); }
static uint16_t pop16(void) { uint8_t lo = stack_pop(); uint8_t hi = stack_pop(); return lo | ((uint16_t)hi << 8); }

/* ─── Flag + ALU helpers (clean-room, copied from 8080.c) ─────────────── */
static uint8_t pack_flags(void) {
    return (G.fs ? F_S : 0) | (G.fz ? F_Z : 0) | (G.fac ? F_AC : 0)
         | (G.fp ? F_P : 0) | F_RES1 | (G.fcy ? F_CY : 0);
}
static void unpack_flags(uint8_t f) {
    G.fs  = (f & F_S)  != 0;
    G.fz  = (f & F_Z)  != 0;
    G.fac = (f & F_AC) != 0;
    G.fp  = (f & F_P)  != 0;
    G.fcy = (f & F_CY) != 0;
}
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
        case 0: return G.b;
        case 1: return G.c;
        case 2: return G.d;
        case 3: return G.e;
        case 4: return G.h;
        case 5: return G.l;
        case 6: return mem_read(G.hl);
        default: return G.acc;
    }
}
static void reg_write_code(uint8_t code, uint8_t v) {
    switch (code & 7) {
        case 0: G.b = v; break;
        case 1: G.c = v; break;
        case 2: G.d = v; break;
        case 3: G.e = v; break;
        case 4: G.h = v; break;
        case 5: G.l = v; break;
        case 6: mem_write(G.hl, v); break;
        default: G.acc = v; break;
    }
}

static void alu_add(uint8_t v, bool with_carry) {
    uint16_t cin = (with_carry && G.fcy) ? 1 : 0;
    uint16_t r   = (uint16_t)G.acc + v + cin;
    G.fac = (((G.acc & 0x0F) + (v & 0x0F) + cin) & 0x10) != 0;
    G.fcy = (r & 0x100) != 0;
    G.acc = (uint8_t)r;
    set_szp(G.acc);
}
static void alu_sub(uint8_t v, bool with_borrow, bool store) {
    uint16_t cin = (with_borrow && G.fcy) ? 1 : 0;
    uint16_t r   = (uint16_t)G.acc - v - cin;
    G.fac = (((G.acc & 0x0F) - (v & 0x0F) - cin) & 0x10) == 0;
    G.fcy = (r & 0x100) != 0;
    uint8_t r8 = (uint8_t)r;
    set_szp(r8);
    if (store) G.acc = r8;
}
static void alu_and(uint8_t v) {
    G.fac = ((G.acc | v) & 0x08) != 0;
    G.acc &= v; G.fcy = false;
    set_szp(G.acc);
}
static void alu_xor(uint8_t v) { G.acc ^= v; G.fcy = false; G.fac = false; set_szp(G.acc); }
static void alu_or (uint8_t v) { G.acc |= v; G.fcy = false; G.fac = false; set_szp(G.acc); }
static void alu_cmp(uint8_t v) { alu_sub(v, false, false); }

static void alu_op(uint8_t op, uint8_t v) {
    switch (op) {
        case 0: alu_add(v, false); break;
        case 1: alu_add(v, true);  break;
        case 2: alu_sub(v, false, true); break;
        case 3: alu_sub(v, true,  true); break;
        case 4: alu_and(v); break;
        case 5: alu_xor(v); break;
        case 6: alu_or(v);  break;
        case 7: alu_cmp(v); break;
    }
}

static uint8_t inr(uint8_t v) {
    uint8_t r = v + 1;
    G.fac = (v & 0x0F) == 0x0F;
    set_szp(r); return r;
}
static uint8_t dcr(uint8_t v) {
    uint8_t r = v - 1;
    G.fac = (v & 0x0F) != 0;
    set_szp(r); return r;
}

static void daa(void) {
    uint8_t correction = 0;
    bool new_cy = G.fcy;
    uint8_t low = G.acc & 0x0F;
    uint8_t high = G.acc >> 4;
    if (low > 9 || G.fac) correction |= 0x06;
    if (high > 9 || G.fcy || (high >= 9 && low > 9)) {
        correction |= 0x60;
        new_cy = true;
    }
    uint8_t old = G.acc;
    G.acc = G.acc + correction;
    G.fac = ((old & 0x0F) + (correction & 0x0F)) > 0x0F;
    G.fcy = new_cy;
    set_szp(G.acc);
}

static void dad(uint16_t v) {
    uint32_t r = (uint32_t)G.hl + v;
    G.fcy = r > 0xFFFF;
    G.hl = (uint16_t)r;
}

static bool cond_met(uint8_t cc) {
    switch (cc & 7) {
        case 0: return !G.fz;
        case 1: return  G.fz;
        case 2: return !G.fcy;
        case 3: return  G.fcy;
        case 4: return !G.fp;
        case 5: return  G.fp;
        case 6: return !G.fs;
        case 7: return  G.fs;
    }
    return false;
}

/* ─── One-instruction step ─────────────────────────────────────────────── */
static void step(void) {
    if (G.halted) return;
    uint8_t op = fetch8();

    if ((op & 0xC0) == 0x40) {
        if (op == 0x76) { G.halted = true; return; }
        reg_write_code(op >> 3, reg_read_code(op));
        return;
    }
    if ((op & 0xC0) == 0x80) { alu_op((op >> 3) & 7, reg_read_code(op)); return; }
    if ((op & 0xC7) == 0x06) { reg_write_code(op >> 3, imm8()); return; }
    if ((op & 0xC7) == 0x04) { uint8_t c = (op >> 3) & 7; reg_write_code(c, inr(reg_read_code(c))); return; }
    if ((op & 0xC7) == 0x05) { uint8_t c = (op >> 3) & 7; reg_write_code(c, dcr(reg_read_code(c))); return; }
    if ((op & 0xC7) == 0xC7) { uint8_t n = (op >> 3) & 7; push16(G.pc); G.pc = (uint16_t)n * 8; return; }
    if ((op & 0xC7) == 0xC2) { uint16_t a = imm16(); if (cond_met((op >> 3) & 7)) G.pc = a; return; }
    if ((op & 0xC7) == 0xC4) { uint16_t a = imm16(); if (cond_met((op >> 3) & 7)) { push16(G.pc); G.pc = a; } return; }
    if ((op & 0xC7) == 0xC0) { if (cond_met((op >> 3) & 7)) G.pc = pop16(); return; }

    switch (op) {
        case 0x00: break;
        case 0x01: G.bc = imm16(); break;
        case 0x11: G.de = imm16(); break;
        case 0x21: G.hl = imm16(); break;
        case 0x31: G.sp = imm16(); break;
        case 0x03: G.bc++; break;
        case 0x13: G.de++; break;
        case 0x23: G.hl++; break;
        case 0x33: G.sp++; break;
        case 0x0B: G.bc--; break;
        case 0x1B: G.de--; break;
        case 0x2B: G.hl--; break;
        case 0x3B: G.sp--; break;
        case 0x09: dad(G.bc); break;
        case 0x19: dad(G.de); break;
        case 0x29: dad(G.hl); break;
        case 0x39: dad(G.sp); break;
        case 0x02: mem_write(G.bc, G.acc); break;
        case 0x12: mem_write(G.de, G.acc); break;
        case 0x0A: G.acc = mem_read(G.bc); break;
        case 0x1A: G.acc = mem_read(G.de); break;
        case 0x32: { uint16_t a = imm16(); mem_write(a, G.acc); break; }
        case 0x3A: { uint16_t a = imm16(); G.acc = mem_read(a); break; }
        case 0x22: { uint16_t a = imm16(); mem_write(a, G.l); mem_write(a+1, G.h); break; }
        case 0x2A: { uint16_t a = imm16(); G.l = mem_read(a); G.h = mem_read(a+1); break; }
        case 0x07: { uint8_t b7 = (G.acc >> 7) & 1; G.acc = (G.acc << 1) | b7; G.fcy = b7; break; }
        case 0x0F: { uint8_t b0 = G.acc & 1; G.acc = (G.acc >> 1) | (b0 << 7); G.fcy = b0; break; }
        case 0x17: { uint8_t b7 = (G.acc >> 7) & 1; G.acc = (G.acc << 1) | (G.fcy ? 1 : 0); G.fcy = b7; break; }
        case 0x1F: { uint8_t b0 = G.acc & 1; G.acc = (G.acc >> 1) | ((G.fcy ? 1 : 0) << 7); G.fcy = b0; break; }
        case 0x27: daa(); break;
        case 0x2F: G.acc = ~G.acc; break;
        case 0x37: G.fcy = true; break;
        case 0x3F: G.fcy = !G.fcy; break;
        case 0xC6: alu_add(imm8(), false); break;
        case 0xCE: alu_add(imm8(), true);  break;
        case 0xD6: alu_sub(imm8(), false, true); break;
        case 0xDE: alu_sub(imm8(), true,  true); break;
        case 0xE6: alu_and(imm8()); break;
        case 0xEE: alu_xor(imm8()); break;
        case 0xF6: alu_or (imm8()); break;
        case 0xFE: alu_cmp(imm8()); break;
        case 0xC3: G.pc = imm16(); break;
        case 0xCD: { uint16_t a = imm16(); push16(G.pc); G.pc = a; break; }
        case 0xC9: G.pc = pop16(); break;
        case 0xE9: G.pc = G.hl; break;
        case 0xC5: stack_push(G.b); stack_push(G.c); break;
        case 0xD5: stack_push(G.d); stack_push(G.e); break;
        case 0xE5: stack_push(G.h); stack_push(G.l); break;
        case 0xF5: stack_push(G.acc); stack_push(pack_flags()); break;
        case 0xC1: G.c = stack_pop(); G.b = stack_pop(); break;
        case 0xD1: G.e = stack_pop(); G.d = stack_pop(); break;
        case 0xE1: G.l = stack_pop(); G.h = stack_pop(); break;
        case 0xF1: { unpack_flags(stack_pop()); G.acc = stack_pop(); break; }
        case 0xE3: { uint8_t lo = mem_read(G.sp), hi = mem_read(G.sp + 1);
                    mem_write(G.sp, G.l); mem_write(G.sp + 1, G.h);
                    G.l = lo; G.h = hi; break; }
        case 0xF9: G.sp = G.hl; break;
        case 0xEB: { uint16_t t = G.de; G.de = G.hl; G.hl = t; break; }
        case 0xFB: G.ime = true;  break;
        case 0xF3: G.ime = false; break;
        default: break;  /* unknown — treat as NOP */
    }
}

/* ─── Hooks ────────────────────────────────────────────────────────────── */
static void on_rx(void* ud, uint8_t byte) {
    (void)ud;
    rx_push(byte);
}
static void on_tx_done(void* ud) { (void)ud; }

static void on_clock(void* ud) {
    (void)ud;
    /* Run a burst of instructions per tick. The chip timer fires every
       100 µs (10 kHz), so 100 instr/burst = ~1 MIPS — comparable to a
       real 2 MHz 8080A and well within what one frame can handle. */
    for (int i = 0; i < 100; i++) step();
}

/* ─── chip_setup ──────────────────────────────────────────────────────── */
void chip_setup(void) {
    /* Pure-UART chip — no GPIO required. Register TX and RX as the only
       pins so the runtime can resolve them; everything else is internal. */
    vx_uart_config cfg = {
        .rx          = vx_pin_register("RX", VX_INPUT),
        .tx          = vx_pin_register("TX", VX_OUTPUT_HIGH),
        .baud_rate   = 9600,
        .on_rx_byte  = on_rx,
        .on_tx_done  = on_tx_done,
        .user_data   = 0,
    };
    g_uart = vx_uart_attach(&cfg);

    /* Optional power pins so the chip looks like real silicon on the canvas. */
    vx_pin_register("VCC", VX_INPUT);
    vx_pin_register("GND", VX_INPUT);

    /* Initial CPU state — PC=0, SP=0, no flags. The program's first
       instruction is LXI SP, 0x10FF so the stack is set immediately. */
    G.pc = 0; G.sp = 0; G.acc = 0;
    G.b = G.c = G.d = G.e = G.h = G.l = 0;
    G.fs = G.fz = G.fac = G.fp = false; G.fcy = false;
    G.halted = false; G.ime = false;

    g_timer = vx_timer_create(on_clock, 0);
    vx_timer_start(g_timer, 100000, true);   /* 100 µs == 10 kHz tick */

    vx_log("i8080-repl ready (291-byte ROM)");
}
