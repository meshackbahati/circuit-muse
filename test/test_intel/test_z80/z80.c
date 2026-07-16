/*
 * Zilog Z80 emulator — clean-room implementation as a velxio custom chip.
 *
 * Sources (in autosearch/pdfs/):
 *   [U] Zilog Z80 Family CPU User Manual UM008003-1202 (2002).
 *   [Y] Sean Young, "The Undocumented Z80 Documented" v0.91 (2005).
 * See autosearch/10_z80_authoritative_spec.md for citations.
 *
 * Scope of this implementation (as targeted by test_z80/z80.test.js):
 *   - Pin contract (all 40 pins).
 *   - M1 + memory R/W bus cycles with RFSH̅ phase (R register
 *     incremented and driven on A0..A6 during refresh).
 *   - 8080-superset instructions (LD, ALU, control flow, stack).
 *   - Z80-only: EX DE,HL ; EX AF,AF' ; EXX ; DJNZ d ; JR e ;
 *     LDIR ; LD A,(IX+d) and the IX/IY family (DD/FD prefix);
 *     IM 0/1/2 + NMI (call 0x0066).
 *
 * Out of scope for now (deferred until ZEXDOC integration):
 *   - X (bit 3) and Y (bit 5) "undocumented" flag bits.
 *   - MEMPTR (WZ) register (only observable via BIT n,(HL)).
 *   - Block I/O instructions (INI/IND/etc.) full flag rules.
 *   - Cycle-accurate WAIT̅ handling.
 * These are tracked as it.todo in the test file and will pass once
 * the spec is fully implemented in a follow-up.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

/* ─── Flag bits in F ─────────────────────────────────────────────────────── */
#define F_S  0x80
#define F_Z  0x40
#define F_Y  0x20    /* bit 5: undocumented — copy of result bit 5. ZEXALL needs it. */
#define F_H  0x10
#define F_X  0x08    /* bit 3: undocumented — copy of result bit 3. */
#define F_PV 0x04
#define F_N  0x02
#define F_C  0x01
#define F_XY 0x28    /* convenience mask: X | Y bits, for set_szp result-copy */

/* ─── Chip state ─────────────────────────────────────────────────────────── */
typedef struct {
    /* Pins */
    vx_pin apin[16], dpin[8];
    vx_pin m1, mreq, iorq, rd, wr, rfsh, halt_, wait_;
    vx_pin intn, nmi, reset_, busreq, busack, clk;
    vx_pin vcc, gnd;
    vx_timer cycle_timer;

    /* Main register set. Pairs aliased — WASM is little-endian, so
       struct {low, high} matches the 16-bit name. Z80 BC: B=high, C=low. */
    union { struct { uint8_t c, b; }; uint16_t bc; };
    union { struct { uint8_t e, d; }; uint16_t de; };
    union { struct { uint8_t l, h; }; uint16_t hl; };
    uint8_t  acc;
    uint8_t  f;
    /* Shadow set */
    uint16_t bc_, de_, hl_;
    uint8_t  acc_, f_;
    /* Index registers */
    union { struct { uint8_t ixl, ixh; }; uint16_t ix; };
    union { struct { uint8_t iyl, iyh; }; uint16_t iy; };
    uint16_t sp, pc;
    uint8_t  i, r;

    bool iff1, iff2;
    uint8_t im;          /* 0, 1, or 2 */
    bool halted;
    bool reset_active;
    bool nmi_pending;
    bool int_line_low;       /* tracked from on_int watcher (INT̅ active low) */
} cpu_t;

static cpu_t G;

/* ─── Bus protocol ───────────────────────────────────────────────────────── */
static void drive_data(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.dpin[i], VX_OUTPUT);
        vx_pin_write(G.dpin[i], (v >> i) & 1);
    }
}
static void release_data(void) {
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.dpin[i], VX_INPUT);
}
static void drive_addr(uint16_t a) {
    for (int i = 0; i < 16; i++) vx_pin_write(G.apin[i], (a >> i) & 1);
}
static uint8_t read_data(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.dpin[i])) v |= (1u << i);
    return v;
}

/* M1 cycle: drive A, then assert MREQ̅+RD̅ FIRST so that when M1̅↓
   fires watchers, all three are already low (test asserts this). Then
   refresh phase: deassert M1̅+MREQ̅+RD̅, drive R on A0..A6 + I on A8..A15
   while pulsing RFSH̅. */
static uint8_t opcode_fetch(uint16_t addr) {
    drive_addr(addr);
    release_data();
    vx_pin_write(G.mreq, 0);
    vx_pin_write(G.rd,   0);
    vx_pin_write(G.m1,   0);    /* fires watchers — all 3 low simultaneously */

    uint8_t v = read_data();

    vx_pin_write(G.m1,   1);
    vx_pin_write(G.rd,   1);
    vx_pin_write(G.mreq, 1);

    /* Refresh phase */
    G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);
    uint16_t ref_addr = ((uint16_t)G.i << 8) | G.r;
    drive_addr(ref_addr);
    vx_pin_write(G.rfsh, 0);
    vx_pin_write(G.mreq, 0);    /* DRAM strobe */
    vx_pin_write(G.mreq, 1);
    vx_pin_write(G.rfsh, 1);
    return v;
}

static uint8_t mem_read(uint16_t addr) {
    drive_addr(addr);
    release_data();
    vx_pin_write(G.mreq, 0);
    vx_pin_write(G.rd,   0);
    uint8_t v = read_data();
    vx_pin_write(G.rd,   1);
    vx_pin_write(G.mreq, 1);
    return v;
}

static void mem_write(uint16_t addr, uint8_t data) {
    drive_addr(addr);
    vx_pin_write(G.mreq, 0);
    drive_data(data);
    vx_pin_write(G.wr, 0);
    vx_pin_write(G.wr, 1);   /* rising edge — external latches */
    vx_pin_write(G.mreq, 1);
}

static uint8_t io_read(uint16_t addr) {
    drive_addr(addr);
    release_data();
    vx_pin_write(G.iorq, 0);
    vx_pin_write(G.rd,   0);
    uint8_t v = read_data();
    vx_pin_write(G.rd,   1);
    vx_pin_write(G.iorq, 1);
    return v;
}

static void io_write(uint16_t addr, uint8_t data) {
    drive_addr(addr);
    vx_pin_write(G.iorq, 0);
    drive_data(data);
    vx_pin_write(G.wr, 0);
    vx_pin_write(G.wr, 1);
    vx_pin_write(G.iorq, 1);
}

static uint8_t fetch8(void) { return opcode_fetch(G.pc++); }
static uint8_t imm8(void)   { return mem_read(G.pc++); }
static uint16_t imm16(void) { uint16_t lo = imm8(); return lo | ((uint16_t)imm8() << 8); }

static void push16(uint16_t v) {
    G.sp -= 1; mem_write(G.sp, v >> 8);
    G.sp -= 1; mem_write(G.sp, v & 0xff);
}
static uint16_t pop16(void) {
    uint8_t lo = mem_read(G.sp); G.sp += 1;
    uint8_t hi = mem_read(G.sp); G.sp += 1;
    return lo | ((uint16_t)hi << 8);
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
static bool parity8(uint8_t v) {
    v ^= v >> 4; v ^= v >> 2; v ^= v >> 1;
    return (v & 1) == 0;
}
/* Set S, Z, X, Y flags from result. Per Sean Young, X/Y are copies of
   bits 3 and 5 of the result for nearly every flag-setting op. */
static void set_sz(uint8_t v) {
    G.f = (G.f & ~(F_S|F_Z|F_XY))
        | (v == 0 ? F_Z : 0)
        | (v & 0x80 ? F_S : 0)
        | (v & F_XY);
}
static void set_szp(uint8_t v) {
    set_sz(v);
    G.f = (G.f & ~F_PV) | (parity8(v) ? F_PV : 0);
}

/* Register file access by 3-bit code 000..111 → B,C,D,E,H,L,(HL),A.
   For DD/FD-prefixed ops, H/L map to IXH/IXL or IYH/IYL — the prefix
   sets a `*hreg` and `*lreg` redirect; (HL) instead becomes (IX+d). */
static uint8_t* reg_ptr(uint8_t code, uint8_t* hreg, uint8_t* lreg) {
    switch (code & 7) {
        case 0: return &G.b;
        case 1: return &G.c;
        case 2: return &G.d;
        case 3: return &G.e;
        case 4: return hreg;
        case 5: return lreg;
        case 6: return NULL;        /* (HL) — caller handles */
        default: return &G.acc;
    }
}

/* ─── ALU ────────────────────────────────────────────────────────────────── */
static void alu_add(uint8_t v, bool with_carry) {
    uint16_t cin = (with_carry && (G.f & F_C)) ? 1 : 0;
    uint16_t r   = (uint16_t)G.acc + v + cin;
    bool h = (((G.acc & 0x0F) + (v & 0x0F) + cin) & 0x10) != 0;
    bool c = (r & 0x100) != 0;
    bool ov = (~(G.acc ^ v) & (G.acc ^ r) & 0x80) != 0;
    G.acc = (uint8_t)r;
    set_sz(G.acc);
    G.f = (G.f & ~(F_H|F_PV|F_N|F_C))
        | (h ? F_H : 0) | (ov ? F_PV : 0) | (c ? F_C : 0);
    /* N=0 (cleared by add) */
}
static void alu_sub(uint8_t v, bool with_borrow, bool store) {
    uint16_t cin = (with_borrow && (G.f & F_C)) ? 1 : 0;
    int      r   = (int)G.acc - (int)v - (int)cin;
    bool h = (((G.acc & 0x0F) - (v & 0x0F) - cin) & 0x10) != 0;
    bool c = (r & 0x100) != 0;
    bool ov = ((G.acc ^ v) & (G.acc ^ (uint8_t)r) & 0x80) != 0;
    uint8_t r8 = (uint8_t)r;
    set_sz(r8);
    G.f = (G.f & ~(F_H|F_PV|F_N|F_C))
        | (h ? F_H : 0) | (ov ? F_PV : 0) | F_N | (c ? F_C : 0);
    if (store) G.acc = r8;
}
static void alu_and(uint8_t v) {
    G.acc &= v;
    set_szp(G.acc);
    G.f = (G.f & ~(F_H|F_N|F_C)) | F_H;
}
static void alu_xor(uint8_t v) {
    G.acc ^= v;
    set_szp(G.acc);
    G.f = (G.f & ~(F_H|F_N|F_C));
}
static void alu_or(uint8_t v) {
    G.acc |= v;
    set_szp(G.acc);
    G.f = (G.f & ~(F_H|F_N|F_C));
}
static void alu_cmp(uint8_t v) {
    alu_sub(v, false, false);
}
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

static uint8_t inr8(uint8_t v) {
    uint8_t r = v + 1;
    bool h = (v & 0x0F) == 0x0F;
    bool ov = v == 0x7F;
    set_sz(r);
    G.f = (G.f & ~(F_H|F_PV|F_N))
        | (h ? F_H : 0) | (ov ? F_PV : 0);
    return r;
}
static uint8_t dcr8(uint8_t v) {
    uint8_t r = v - 1;
    bool h = (v & 0x0F) == 0;
    bool ov = v == 0x80;
    set_sz(r);
    G.f = (G.f & ~(F_H|F_PV|F_N))
        | (h ? F_H : 0) | (ov ? F_PV : 0) | F_N;
    return r;
}

/* 16-bit ADD HL,rr: only H, N, C affected; per [U] p. 179.
   Per Sean Young: X/Y are copies of the high byte of the result. */
static void add_hl(uint16_t* dest, uint16_t v) {
    uint32_t r = (uint32_t)*dest + v;
    bool h = (((*dest & 0x0FFF) + (v & 0x0FFF)) & 0x1000) != 0;
    G.f = (G.f & ~(F_H|F_N|F_C|F_XY))
        | (h ? F_H : 0)
        | (r > 0xFFFF ? F_C : 0)
        | ((r >> 8) & F_XY);
    *dest = (uint16_t)r;
}

/* 16-bit ADC HL, rr (ED 4A/5A/6A/7A): all flags affected. */
static void adc_hl(uint16_t v) {
    uint32_t cin = (G.f & F_C) ? 1 : 0;
    uint32_t r = (uint32_t)G.hl + v + cin;
    bool c = r > 0xFFFF;
    bool h = (((G.hl & 0x0FFF) + (v & 0x0FFF) + cin) & 0x1000) != 0;
    bool ov = (~(G.hl ^ v) & (G.hl ^ (uint16_t)r) & 0x8000) != 0;
    uint16_t r16 = (uint16_t)r;
    G.f = (h ? F_H : 0) | (c ? F_C : 0) | (ov ? F_PV : 0)
        | (r16 == 0 ? F_Z : 0)
        | (r16 & 0x8000 ? F_S : 0)
        | ((r16 >> 8) & F_XY);
    G.hl = r16;
}

/* 16-bit SBC HL, rr (ED 42/52/62/72): all flags affected. */
static void sbc_hl(uint16_t v) {
    uint32_t cin = (G.f & F_C) ? 1 : 0;
    int32_t r = (int32_t)G.hl - (int32_t)v - (int32_t)cin;
    bool c = (r & 0x10000) != 0;
    bool h = (((G.hl & 0x0FFF) - (v & 0x0FFF) - cin) & 0x1000) != 0;
    bool ov = ((G.hl ^ v) & (G.hl ^ (uint16_t)r) & 0x8000) != 0;
    uint16_t r16 = (uint16_t)r;
    G.f = F_N | (h ? F_H : 0) | (c ? F_C : 0) | (ov ? F_PV : 0)
        | (r16 == 0 ? F_Z : 0)
        | (r16 & 0x8000 ? F_S : 0)
        | ((r16 >> 8) & F_XY);
    G.hl = r16;
}

/* DAA — Z80 variant. The N flag selects sub vs add behaviour.
   Algorithm per Sean Young §4.7 (validated against ZEXALL). */
static void daa_z80(void) {
    uint8_t a = G.acc;
    uint8_t correction = 0;
    bool new_cf = (G.f & F_C) != 0;
    bool new_hf = false;

    if ((a & 0x0F) > 9 || (G.f & F_H)) correction |= 0x06;
    if (a > 0x99 || (G.f & F_C)) { correction |= 0x60; new_cf = true; }

    uint8_t old_a = a;
    if (G.f & F_N) {
        a = (uint8_t)(a - correction);
        /* New HF = old_HF AND (low nibble of A < 6) — borrow indication. */
        new_hf = ((G.f & F_H) != 0) && ((old_a & 0x0F) < 6);
    } else {
        a = (uint8_t)(a + correction);
        new_hf = ((old_a & 0x0F) + (correction & 0x0F)) > 0x0F;
    }

    G.acc = a;
    G.f = (G.f & F_N)   /* preserve N */
        | (a == 0 ? F_Z : 0)
        | (a & 0x80 ? F_S : 0)
        | (a & F_XY)
        | (parity8(a) ? F_PV : 0)
        | (new_hf ? F_H : 0)
        | (new_cf ? F_C : 0);
}

/* RLD: rotate the low nibble of (HL) and the low nibble of A leftward
   through a 12-bit ring. After: A_low ← (HL)_high, (HL)_high ← (HL)_low,
   (HL)_low ← old_A_low. Flags S/Z/P from new A. */
static void rld_op(void) {
    uint8_t m = mem_read(G.hl);
    uint8_t a_low = G.acc & 0x0F;
    uint8_t new_a = (G.acc & 0xF0) | ((m >> 4) & 0x0F);
    uint8_t new_m = (uint8_t)((m << 4) | a_low);
    mem_write(G.hl, new_m);
    G.acc = new_a;
    G.f = (G.f & F_C)
        | (new_a == 0 ? F_Z : 0)
        | (new_a & 0x80 ? F_S : 0)
        | (new_a & F_XY)
        | (parity8(new_a) ? F_PV : 0);
}
/* RRD: rotate rightward. A_low ← (HL)_low, (HL)_low ← (HL)_high,
   (HL)_high ← old_A_low. */
static void rrd_op(void) {
    uint8_t m = mem_read(G.hl);
    uint8_t a_low = G.acc & 0x0F;
    uint8_t new_a = (G.acc & 0xF0) | (m & 0x0F);
    uint8_t new_m = (uint8_t)((a_low << 4) | ((m >> 4) & 0x0F));
    mem_write(G.hl, new_m);
    G.acc = new_a;
    G.f = (G.f & F_C)
        | (new_a == 0 ? F_Z : 0)
        | (new_a & 0x80 ? F_S : 0)
        | (new_a & F_XY)
        | (parity8(new_a) ? F_PV : 0);
}

/* Block compare CPI/CPD: A − (HL); set flags; HL +/-; BC--; PV = (BC≠0). */
static void cp_block(int dir) {
    uint8_t v = mem_read(G.hl);
    uint8_t r = G.acc - v;
    bool h = (((G.acc & 0x0F) - (v & 0x0F)) & 0x10) != 0;
    G.hl = (uint16_t)(G.hl + dir);
    G.bc = (uint16_t)(G.bc - 1);
    /* X = bit 3 of (A − (HL) − H), Y = bit 1 of same, per Sean Young §4.2 */
    uint8_t n = (uint8_t)(r - (h ? 1 : 0));
    G.f = (G.f & F_C)
        | F_N
        | (h ? F_H : 0)
        | (r == 0 ? F_Z : 0)
        | (r & 0x80 ? F_S : 0)
        | (G.bc != 0 ? F_PV : 0)
        | (n & 0x08 ? F_X : 0)
        | (n & 0x02 ? F_Y : 0);
}

/* ─── Conditional flag tests for JP/JR/CALL/RET cc ───────────────────────── */
static bool cond_met(uint8_t cc) {
    switch (cc & 7) {
        case 0: return !(G.f & F_Z);   /* NZ */
        case 1: return  (G.f & F_Z);   /* Z  */
        case 2: return !(G.f & F_C);   /* NC */
        case 3: return  (G.f & F_C);   /* C  */
        case 4: return !(G.f & F_PV);  /* PO */
        case 5: return  (G.f & F_PV);  /* PE */
        case 6: return !(G.f & F_S);   /* P  */
        default:return  (G.f & F_S);   /* M  */
    }
}

/* ─── Forward declaration of the prefix-aware dispatcher ─────────────────── */
static void execute_main(uint8_t op, uint16_t* hl_reg, uint8_t* hreg, uint8_t* lreg, bool indexed, int8_t disp);

/* ─── CB-prefix ops (BIT/SET/RES + rotates/shifts) ──────────────────────── */
/* Operand selection by 3-bit r/m code:
   0..5 = B,C,D,E,H,L; 6 = (HL); 7 = A.
   For DD/FD CB (indexed), the operand is always (IX+d) or (IY+d) and
   the result is also written back to the chosen register UNLESS reg=6. */
static void execute_cb(uint16_t* hl_reg, uint8_t* hreg, uint8_t* lreg,
                       bool indexed, int8_t disp) {
    uint8_t op;
    if (!indexed) {
        op = opcode_fetch(G.pc++);
        /* CB is an M1 prefix → R already incremented by the outer fetch
           of CB; the inner opcode is also M1 → +1 more. */
        G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);
    } else {
        /* DDCB / FDCB: byte after the displacement is the opcode and
           is NOT an M1 fetch (Sean Young §6.1). R unchanged for it. */
        op = imm8();
    }

    uint8_t reg_code = op & 7;
    uint8_t bit_op   = (op >> 3) & 7;
    uint8_t op_class = (op >> 6) & 3;

    /* Read operand */
    uint8_t v;
    uint16_t mem_addr = 0;
    if (indexed) {
        mem_addr = (uint16_t)(*hl_reg + disp);
        v = mem_read(mem_addr);
    } else if (reg_code == 6) {
        mem_addr = *hl_reg;
        v = mem_read(mem_addr);
    } else {
        v = *reg_ptr(reg_code, hreg, lreg);
    }

    uint8_t r = v;
    uint8_t cy_out = 0;
    bool writeback = true;

    switch (op_class) {
        case 0: {  /* rotate / shift */
            switch (bit_op) {
                case 0: cy_out = (v >> 7) & 1; r = (uint8_t)((v << 1) | cy_out); break;            /* RLC */
                case 1: cy_out = v & 1;        r = (uint8_t)((v >> 1) | (cy_out << 7)); break;     /* RRC */
                case 2: cy_out = (v >> 7) & 1; r = (uint8_t)((v << 1) | (G.f & F_C ? 1 : 0)); break; /* RL */
                case 3: cy_out = v & 1;        r = (uint8_t)((v >> 1) | ((G.f & F_C ? 1 : 0) << 7)); break; /* RR */
                case 4: cy_out = (v >> 7) & 1; r = (uint8_t)(v << 1); break;                        /* SLA */
                case 5: cy_out = v & 1;        r = (uint8_t)((v >> 1) | (v & 0x80)); break;         /* SRA — sign-extend */
                case 6: cy_out = (v >> 7) & 1; r = (uint8_t)((v << 1) | 1); break;                  /* SLL (undocumented) */
                case 7: cy_out = v & 1;        r = (uint8_t)(v >> 1); break;                        /* SRL */
            }
            G.f = (cy_out ? F_C : 0)
                | (r & 0x80 ? F_S : 0)
                | (r == 0 ? F_Z : 0)
                | (r & F_XY)
                | (parity8(r) ? F_PV : 0);
            break;
        }
        case 1: {  /* BIT n, r — test bit n */
            uint8_t mask = (uint8_t)(1u << bit_op);
            uint8_t bit_set = v & mask;
            /* Per Sean Young §4.1: SF set iff testing bit 7 AND that bit is 1.
               PF/V = ZF.  HF = 1.  NF = 0.  CF unchanged.
               X/Y from operand bits 3/5 (technically MEMPTR for (HL); we
               approximate with v's bits which is correct for register
               operands and a known-acceptable approximation for memory). */
            G.f = (G.f & F_C)
                | F_H
                | (bit_set ? 0 : F_Z)
                | (bit_set ? 0 : F_PV)
                | (bit_op == 7 && bit_set ? F_S : 0)
                | (v & F_XY);
            return;   /* BIT does not write back */
        }
        case 2: r = (uint8_t)(v & ~((uint8_t)1u << bit_op)); break;   /* RES */
        case 3: r = (uint8_t)(v |  ((uint8_t)1u << bit_op)); break;   /* SET */
    }

    /* Write back */
    if (indexed) {
        mem_write(mem_addr, r);
        /* DDCB/FDCB undocumented: result also stored in the chosen
           register (when reg_code != 6). The register is ALWAYS one
           of the *non-indexed* H/L (i.e. real H/L), not IXH/IXL,
           per Sean Young. We follow that convention. */
        if (reg_code != 6) {
            uint8_t* dst;
            switch (reg_code) {
                case 0: dst = &G.b; break;
                case 1: dst = &G.c; break;
                case 2: dst = &G.d; break;
                case 3: dst = &G.e; break;
                case 4: dst = &G.h; break;
                case 5: dst = &G.l; break;
                default: dst = &G.acc; break;
            }
            *dst = r;
        }
    } else if (reg_code == 6) {
        mem_write(mem_addr, r);
    } else {
        *reg_ptr(reg_code, hreg, lreg) = r;
    }
    (void)writeback;
}

/* ─── ED-prefix opcodes ─────────────────────────────────────────────────── */
static void execute_ed(void) {
    uint8_t op = opcode_fetch(G.pc++);
    G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);  /* second M1 for prefix */
    switch (op) {
        case 0x46: case 0x4E: case 0x66: case 0x6E: G.im = 0; break;     /* IM 0 */
        case 0x56: case 0x76:                       G.im = 1; break;     /* IM 1 */
        case 0x5E: case 0x7E:                       G.im = 2; break;     /* IM 2 */
        case 0x47: G.i = G.acc; break;                                   /* LD I,A */
        case 0x4F: G.r = G.acc; break;                                   /* LD R,A */
        case 0x57: G.acc = G.i;                                          /* LD A,I */
                   set_sz(G.acc);
                   G.f = (G.f & ~(F_H|F_PV|F_N)) | (G.iff2 ? F_PV : 0);
                   break;
        case 0x5F: G.acc = G.r;                                          /* LD A,R */
                   set_sz(G.acc);
                   G.f = (G.f & ~(F_H|F_PV|F_N)) | (G.iff2 ? F_PV : 0);
                   break;
        case 0x44: case 0x4C: case 0x54: case 0x5C:
        case 0x64: case 0x6C: case 0x74: case 0x7C: {                    /* NEG (8 aliases) */
            uint8_t old = G.acc;
            G.acc = (uint8_t)(0 - old);
            set_sz(G.acc);
            G.f = (G.f & ~(F_H|F_PV|F_N|F_C))
                | F_N
                | ((old & 0x0F) ? F_H : 0)       /* low nibble borrow */
                | (old == 0x80 ? F_PV : 0)
                | (old != 0 ? F_C : 0);
            break;
        }
        case 0x45: case 0x4D: {                                           /* RETN / RETI */
            G.pc = pop16();
            G.iff1 = G.iff2;
            break;
        }
        /* 16-bit ADC HL, rr / SBC HL, rr */
        case 0x4A: adc_hl(G.bc); break;
        case 0x5A: adc_hl(G.de); break;
        case 0x6A: adc_hl(G.hl); break;
        case 0x7A: adc_hl(G.sp); break;
        case 0x42: sbc_hl(G.bc); break;
        case 0x52: sbc_hl(G.de); break;
        case 0x62: sbc_hl(G.hl); break;
        case 0x72: sbc_hl(G.sp); break;
        /* RLD / RRD */
        case 0x6F: rld_op(); break;
        case 0x67: rrd_op(); break;
        /* Block compare CPI/CPD/CPIR/CPDR */
        case 0xA1: cp_block(+1); break;
        case 0xA9: cp_block(-1); break;
        case 0xB1: do { cp_block(+1); } while (G.bc != 0 && (G.f & F_Z) == 0); break;
        case 0xB9: do { cp_block(-1); } while (G.bc != 0 && (G.f & F_Z) == 0); break;
        case 0xA0: {                                                      /* LDI */
            mem_write(G.de, mem_read(G.hl));
            G.hl++; G.de++; G.bc--;
            G.f = (G.f & ~(F_H|F_PV|F_N)) | (G.bc != 0 ? F_PV : 0);
            break;
        }
        case 0xB0: {                                                      /* LDIR */
            do {
                mem_write(G.de, mem_read(G.hl));
                G.hl++; G.de++; G.bc--;
            } while (G.bc != 0);
            G.f &= ~(F_H|F_PV|F_N);
            break;
        }
        case 0xA8: {                                                      /* LDD */
            mem_write(G.de, mem_read(G.hl));
            G.hl--; G.de--; G.bc--;
            G.f = (G.f & ~(F_H|F_PV|F_N)) | (G.bc != 0 ? F_PV : 0);
            break;
        }
        case 0xB8: {                                                      /* LDDR */
            do {
                mem_write(G.de, mem_read(G.hl));
                G.hl--; G.de--; G.bc--;
            } while (G.bc != 0);
            G.f &= ~(F_H|F_PV|F_N);
            break;
        }
        /* LD (nn),rr  /  LD rr,(nn)  for BC, DE, SP (HL has its own opcode) */
        case 0x43: { uint16_t a = imm16(); mem_write(a, G.c); mem_write(a+1, G.b); break; }
        case 0x53: { uint16_t a = imm16(); mem_write(a, G.e); mem_write(a+1, G.d); break; }
        case 0x73: { uint16_t a = imm16(); mem_write(a, G.sp & 0xff); mem_write(a+1, G.sp >> 8); break; }
        case 0x4B: { uint16_t a = imm16(); G.c = mem_read(a); G.b = mem_read(a+1); break; }
        case 0x5B: { uint16_t a = imm16(); G.e = mem_read(a); G.d = mem_read(a+1); break; }
        case 0x7B: { uint16_t a = imm16(); uint8_t lo = mem_read(a), hi = mem_read(a+1); G.sp = lo | (hi<<8); break; }
        default: break;  /* unimplemented ED — treat as NOP for now */
    }
}

/* ─── DD / FD prefix (IX / IY substitution) ─────────────────────────────── */
static void execute_indexed(uint16_t* idx_reg, uint8_t* idx_h, uint8_t* idx_l) {
    uint8_t op = opcode_fetch(G.pc++);
    G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);
    int8_t disp = 0;

    /* DDCB / FDCB: displacement comes BEFORE the inner opcode, then the
       opcode follows. Both bytes are non-M1, so R is not incremented for
       them. */
    if (op == 0xCB) {
        disp = (int8_t)imm8();
        execute_cb(idx_reg, idx_h, idx_l, true, disp);
        return;
    }

    bool needs_disp = false;
    if (op == 0x36) needs_disp = true;                        /* LD (IX+d),n */
    if ((op & 0xC7) == 0x46) needs_disp = true;                /* LD r,(IX+d)  bits 6..0 = ?_110 */
    if ((op & 0xF8) == 0x70 && op != 0x76) needs_disp = true;  /* LD (IX+d),r */
    if ((op & 0xC7) == 0x86) needs_disp = true;                /* ALU op A,(IX+d) — only the ?_110 forms */
    if (op == 0x34 || op == 0x35) needs_disp = true;          /* INC/DEC (IX+d) */

    if (needs_disp) disp = (int8_t)imm8();

    execute_main(op, idx_reg, idx_h, idx_l, true, disp);
}

/* ─── Step one instruction ──────────────────────────────────────────────── */
static void step(void) {
    if (G.nmi_pending) {
        G.nmi_pending = false;
        G.iff1 = false;
        G.halted = false;
        G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);
        push16(G.pc);
        G.pc = 0x0066;
        return;
    }

    /* Maskable interrupt: INT̅ is level-triggered (active low). Service
       at instruction boundary if IFF1 is enabled and we're not halted
       on a non-interruptible state. Per [U] p. 24: INTA cycle clears
       both IFF1 and IFF2. */
    if (G.int_line_low && G.iff1) {
        G.iff1 = G.iff2 = false;
        G.halted = false;
        G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F);
        push16(G.pc);
        switch (G.im) {
            case 0:
                /* IM 0 reads an instruction byte from the data bus
                   during INTA — usually a RST. Without an interrupt
                   controller wired, default to RST 38h. */
                G.pc = 0x0038;
                break;
            case 1:
                G.pc = 0x0038;
                break;
            case 2:
                /* IM 2: vector = (I << 8) | data_byte. Without a real
                   interrupt controller we approximate using 0x00 as
                   the data byte; user code must pre-load the vector
                   table at I:00. */
                {
                    uint16_t va = ((uint16_t)G.i << 8) | 0x00;
                    uint8_t lo = mem_read(va);
                    uint8_t hi = mem_read((uint16_t)(va + 1));
                    G.pc = lo | ((uint16_t)hi << 8);
                }
                break;
        }
        return;
    }

    if (G.halted) {
        /* Re-emit a no-op M1 fetch so RFSH̅ keeps cycling (matches real
           silicon, which fetches the byte at PC repeatedly while halted). */
        opcode_fetch(G.pc);
        return;
    }

    uint8_t op = opcode_fetch(G.pc++);

    if (op == 0xED) { execute_ed(); return; }
    if (op == 0xDD) { execute_indexed(&G.ix, &G.ixh, &G.ixl); return; }
    if (op == 0xFD) { execute_indexed(&G.iy, &G.iyh, &G.iyl); return; }
    if (op == 0xCB) { execute_cb(&G.hl, &G.h, &G.l, false, 0); return; }

    execute_main(op, &G.hl, &G.h, &G.l, false, 0);
}

/* ─── Main opcode dispatch ──────────────────────────────────────────────── */
static void execute_main(uint8_t op, uint16_t* hl_reg, uint8_t* hreg, uint8_t* lreg, bool indexed, int8_t disp) {
    /* Memory operand for this instruction. With DD/FD prefix, "(HL)"
       in any 3-bit reg-code becomes (IX+d) / (IY+d); the disp byte
       was already consumed by execute_indexed. */
    #define MEMOP_ADDR  (indexed ? (uint16_t)(*hl_reg + disp) : *hl_reg)

    /* ── HALT ────────────────────────────────────────────────────────── */
    if (op == 0x76) { G.halted = true; return; }

    /* ── MOV r,r' / LD r,r' ─────────────────────────────────────────── */
    if ((op & 0xC0) == 0x40) {
        uint8_t src_code = op & 7;
        uint8_t dst_code = (op >> 3) & 7;
        uint8_t v;
        /* src */
        if (src_code == 6) v = mem_read(MEMOP_ADDR);
        else { uint8_t* p = reg_ptr(src_code, hreg, lreg); v = *p; }
        /* dst */
        if (dst_code == 6) mem_write(MEMOP_ADDR, v);
        else { uint8_t* p = reg_ptr(dst_code, hreg, lreg); *p = v; }
        return;
    }

    /* ── ALU op A,r / A,(HL) ─────────────────────────────────────────── */
    if ((op & 0xC0) == 0x80) {
        uint8_t src_code = op & 7;
        uint8_t v;
        if (src_code == 6) v = mem_read(MEMOP_ADDR);
        else { uint8_t* p = reg_ptr(src_code, hreg, lreg); v = *p; }
        alu_op((op >> 3) & 7, v);
        return;
    }

    /* ── LD r,n  /  LD (HL),n ────────────────────────────────────────── */
    if ((op & 0xC7) == 0x06) {
        uint8_t dst_code = (op >> 3) & 7;
        uint8_t n = imm8();
        if (dst_code == 6) mem_write(MEMOP_ADDR, n);
        else { uint8_t* p = reg_ptr(dst_code, hreg, lreg); *p = n; }
        return;
    }

    /* ── INC r / DEC r / INC (HL) / DEC (HL) ─────────────────────────── */
    if ((op & 0xC7) == 0x04) {
        uint8_t code = (op >> 3) & 7;
        if (code == 6) {
            uint16_t a = MEMOP_ADDR;
            mem_write(a, inr8(mem_read(a)));
        } else {
            uint8_t* p = reg_ptr(code, hreg, lreg); *p = inr8(*p);
        }
        return;
    }
    if ((op & 0xC7) == 0x05) {
        uint8_t code = (op >> 3) & 7;
        if (code == 6) {
            uint16_t a = MEMOP_ADDR;
            mem_write(a, dcr8(mem_read(a)));
        } else {
            uint8_t* p = reg_ptr(code, hreg, lreg); *p = dcr8(*p);
        }
        return;
    }

    /* ── RST n ──────────────────────────────────────────────────────── */
    if ((op & 0xC7) == 0xC7) {
        push16(G.pc);
        G.pc = (uint16_t)((op >> 3) & 7) * 8;
        return;
    }

    /* ── Conditional JP / CALL / RET ─────────────────────────────────── */
    if ((op & 0xC7) == 0xC2) {
        uint16_t a = imm16();
        if (cond_met((op >> 3) & 7)) G.pc = a;
        return;
    }
    if ((op & 0xC7) == 0xC4) {
        uint16_t a = imm16();
        if (cond_met((op >> 3) & 7)) { push16(G.pc); G.pc = a; }
        return;
    }
    if ((op & 0xC7) == 0xC0) {
        if (cond_met((op >> 3) & 7)) G.pc = pop16();
        return;
    }

    /* ── Specific opcodes ────────────────────────────────────────────── */
    switch (op) {
        case 0x00: /* NOP */ break;

        /* LD rr,nn — note H pair becomes IX/IY when indexed */
        case 0x01: G.bc = imm16(); break;
        case 0x11: G.de = imm16(); break;
        case 0x21: *hl_reg = imm16(); break;
        case 0x31: G.sp = imm16(); break;

        /* INC rr / DEC rr */
        case 0x03: G.bc++; break;
        case 0x13: G.de++; break;
        case 0x23: (*hl_reg)++; break;
        case 0x33: G.sp++; break;
        case 0x0B: G.bc--; break;
        case 0x1B: G.de--; break;
        case 0x2B: (*hl_reg)--; break;
        case 0x3B: G.sp--; break;

        /* ADD HL/IX/IY,rr */
        case 0x09: add_hl(hl_reg, G.bc); break;
        case 0x19: add_hl(hl_reg, G.de); break;
        case 0x29: add_hl(hl_reg, *hl_reg); break;
        case 0x39: add_hl(hl_reg, G.sp); break;

        /* LD A,(BC)/(DE) ; LD (BC)/(DE),A */
        case 0x02: mem_write(G.bc, G.acc); break;
        case 0x12: mem_write(G.de, G.acc); break;
        case 0x0A: G.acc = mem_read(G.bc); break;
        case 0x1A: G.acc = mem_read(G.de); break;

        /* LD (nn),A / LD A,(nn) / LD (nn),HL / LD HL,(nn) */
        case 0x32: { uint16_t a = imm16(); mem_write(a, G.acc); break; }
        case 0x3A: { uint16_t a = imm16(); G.acc = mem_read(a); break; }
        case 0x22: { uint16_t a = imm16(); mem_write(a, *lreg); mem_write(a+1, *hreg); break; }
        case 0x2A: { uint16_t a = imm16(); *lreg = mem_read(a); *hreg = mem_read(a+1); break; }

        /* Rotate-A family */
        case 0x07: { uint8_t b7 = G.acc >> 7; G.acc = (G.acc << 1) | b7;
                     G.f = (G.f & ~(F_H|F_N|F_C)) | (b7 ? F_C : 0); break; }
        case 0x0F: { uint8_t b0 = G.acc & 1; G.acc = (G.acc >> 1) | (b0 << 7);
                     G.f = (G.f & ~(F_H|F_N|F_C)) | (b0 ? F_C : 0); break; }
        case 0x17: { uint8_t b7 = G.acc >> 7; G.acc = (G.acc << 1) | (G.f & F_C ? 1 : 0);
                     G.f = (G.f & ~(F_H|F_N|F_C)) | (b7 ? F_C : 0); break; }
        case 0x1F: { uint8_t b0 = G.acc & 1; G.acc = (G.acc >> 1) | ((G.f & F_C ? 1 : 0) << 7);
                     G.f = (G.f & ~(F_H|F_N|F_C)) | (b0 ? F_C : 0); break; }

        case 0x27: daa_z80(); break;                              /* DAA */
        case 0x2F: G.acc = ~G.acc; G.f |= (F_H|F_N); G.f = (G.f & ~F_XY) | (G.acc & F_XY); break;  /* CPL */
        case 0x37: G.f = (G.f & ~(F_H|F_N)) | F_C; break;          /* SCF */
        case 0x3F: G.f = (G.f & ~(F_N)) | ((G.f & F_C) ? F_H : 0)
                     ^ F_C; break;                                  /* CCF (approximated) */

        /* Immediate ALU */
        case 0xC6: alu_add(imm8(), false); break;
        case 0xCE: alu_add(imm8(), true);  break;
        case 0xD6: alu_sub(imm8(), false, true); break;
        case 0xDE: alu_sub(imm8(), true,  true); break;
        case 0xE6: alu_and(imm8()); break;
        case 0xEE: alu_xor(imm8()); break;
        case 0xF6: alu_or(imm8());  break;
        case 0xFE: alu_cmp(imm8()); break;

        /* Unconditional flow */
        case 0xC3: G.pc = imm16(); break;
        case 0xCD: { uint16_t a = imm16(); push16(G.pc); G.pc = a; break; }
        case 0xC9: G.pc = pop16(); break;
        case 0xE9: G.pc = *hl_reg; break;                          /* JP (HL/IX/IY) */
        case 0x18: { int8_t e = (int8_t)imm8(); G.pc += e; break; } /* JR e */
        case 0x20: { int8_t e = (int8_t)imm8(); if (!(G.f & F_Z)) G.pc += e; break; } /* JR NZ */
        case 0x28: { int8_t e = (int8_t)imm8(); if (  G.f & F_Z) G.pc += e; break; } /* JR Z */
        case 0x30: { int8_t e = (int8_t)imm8(); if (!(G.f & F_C)) G.pc += e; break; } /* JR NC */
        case 0x38: { int8_t e = (int8_t)imm8(); if (  G.f & F_C) G.pc += e; break; } /* JR C */
        case 0x10: { int8_t e = (int8_t)imm8(); G.b--; if (G.b != 0) G.pc += e; break; } /* DJNZ */

        /* Stack */
        case 0xC5: push16(G.bc); break;
        case 0xD5: push16(G.de); break;
        case 0xE5: push16(*hl_reg); break;
        case 0xF5: push16(((uint16_t)G.acc << 8) | G.f); break;
        case 0xC1: G.bc = pop16(); break;
        case 0xD1: G.de = pop16(); break;
        case 0xE1: *hl_reg = pop16(); break;
        case 0xF1: { uint16_t v = pop16(); G.f = v & 0xff; G.acc = v >> 8; break; }
        case 0xE3: { /* EX (SP),HL/IX/IY */
            uint8_t lo = mem_read(G.sp), hi = mem_read(G.sp + 1);
            mem_write(G.sp, *lreg); mem_write(G.sp + 1, *hreg);
            *lreg = lo; *hreg = hi;
            break;
        }
        case 0xF9: G.sp = *hl_reg; break;
        case 0xEB: { uint16_t t = G.de; G.de = G.hl; G.hl = t; break; } /* EX DE,HL */
        case 0x08: { uint8_t ta=G.acc, tf=G.f; G.acc=G.acc_; G.f=G.f_; G.acc_=ta; G.f_=tf; break; } /* EX AF,AF' */
        case 0xD9: { uint16_t tb=G.bc, td=G.de, th=G.hl;                             /* EXX */
                     G.bc=G.bc_; G.de=G.de_; G.hl=G.hl_;
                     G.bc_=tb; G.de_=td; G.hl_=th; break; }

        /* I/O */
        case 0xDB: G.acc = io_read(((uint16_t)G.acc << 8) | imm8()); break;
        case 0xD3: io_write(((uint16_t)G.acc << 8) | imm8(), G.acc); break;

        /* Interrupt control */
        case 0xFB: G.iff1 = G.iff2 = true; break;                  /* EI */
        case 0xF3: G.iff1 = G.iff2 = false; break;                 /* DI */

        default: /* unimplemented — NOP */ break;
    }
    #undef MEMOP_ADDR
}

/* ─── Reset / pin watchers / clock ──────────────────────────────────────── */
static void reset_state(void) {
    /* Per [Y] §2.4: real silicon leaves AF=SP=FFFFh; all others
       indeterminate (we use FFFFh as a defensible default). PC=I=R=0. */
    G.acc = 0xFF; G.f = 0xFF;
    G.bc = G.de = G.hl = 0xFFFF;
    G.acc_ = 0xFF; G.f_ = 0xFF;
    G.bc_ = G.de_ = G.hl_ = 0xFFFF;
    G.ix = G.iy = 0xFFFF;
    G.sp = 0xFFFF;
    G.pc = 0;
    G.i = 0; G.r = 0;
    G.iff1 = G.iff2 = false;
    G.im = 0;
    G.halted = false;
    G.nmi_pending = false;
    /* Idle bus */
    vx_pin_write(G.m1,    1);
    vx_pin_write(G.mreq,  1);
    vx_pin_write(G.iorq,  1);
    vx_pin_write(G.rd,    1);
    vx_pin_write(G.wr,    1);
    vx_pin_write(G.rfsh,  1);
    vx_pin_write(G.halt_, 1);
    vx_pin_write(G.busack,1);
    release_data();
}

static void on_reset(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    /* RESET̅ is active LOW. */
    if (value == 0) {
        G.reset_active = true;
        reset_state();
    } else {
        G.reset_active = false;
    }
}

static void on_nmi(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin; (void)value;
    G.nmi_pending = true;
}

static void on_int(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    /* INT̅ is level-triggered, active low. Track its level and let
       step() decide when to service it. */
    G.int_line_low = (value == 0);
}

static void on_clock(void* user_data) {
    (void)user_data;
    if (G.reset_active) return;
    if (vx_pin_read(G.busreq) == 0) {
        vx_pin_write(G.busack, 0);
        return;
    }
    vx_pin_write(G.busack, 1);
    if (vx_pin_read(G.wait_) == 0) return;
    step();
    /* HALT̅ output reflects internal halted state. */
    vx_pin_write(G.halt_, G.halted ? 0 : 1);
}

/* ─── Setup ─────────────────────────────────────────────────────────────── */
void chip_setup(void) {
    char name[5];
    for (int i = 0; i < 16; i++) {
        name[0]='A';
        if (i<10) { name[1]='0'+i; name[2]=0; }
        else      { name[1]='1'; name[2]='0'+(i-10); name[3]=0; }
        G.apin[i] = vx_pin_register(name, VX_OUTPUT_LOW);
    }
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.dpin[i] = vx_pin_register(name, VX_INPUT);
    }
    G.m1     = vx_pin_register("M1",     VX_OUTPUT_HIGH);
    G.mreq   = vx_pin_register("MREQ",   VX_OUTPUT_HIGH);
    G.iorq   = vx_pin_register("IORQ",   VX_OUTPUT_HIGH);
    G.rd     = vx_pin_register("RD",     VX_OUTPUT_HIGH);
    G.wr     = vx_pin_register("WR",     VX_OUTPUT_HIGH);
    G.rfsh   = vx_pin_register("RFSH",   VX_OUTPUT_HIGH);
    G.halt_  = vx_pin_register("HALT",   VX_OUTPUT_HIGH);
    G.wait_  = vx_pin_register("WAIT",   VX_INPUT);
    G.intn   = vx_pin_register("INT",    VX_INPUT);
    G.nmi    = vx_pin_register("NMI",    VX_INPUT);
    G.reset_ = vx_pin_register("RESET",  VX_INPUT);
    G.busreq = vx_pin_register("BUSREQ", VX_INPUT);
    G.busack = vx_pin_register("BUSACK", VX_OUTPUT_HIGH);
    G.clk    = vx_pin_register("CLK",    VX_INPUT);
    G.vcc    = vx_pin_register("VCC",    VX_INPUT);
    G.gnd    = vx_pin_register("GND",    VX_INPUT);

    reset_state();
    /* Power-on default: hold the chip in reset until something drives
       RESET̅ HIGH. Real silicon is the same — RESET̅ must be held low
       for ≥3 clocks at power-on, but in our digital model the watcher
       only fires on edges, so we start in reset and let the rising
       edge release us. */
    G.reset_active = true;
    vx_pin_watch(G.reset_, VX_EDGE_BOTH,    on_reset, 0);
    vx_pin_watch(G.nmi,    VX_EDGE_FALLING, on_nmi,   0);
    vx_pin_watch(G.intn,   VX_EDGE_BOTH,    on_int,   0);

    G.cycle_timer = vx_timer_create(on_clock, 0);
    vx_timer_start(G.cycle_timer, 250, true);   /* 4 MHz pseudo-clock */
}
