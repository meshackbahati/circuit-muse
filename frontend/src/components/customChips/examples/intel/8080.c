/*
 * Intel 8080 emulator — clean-room implementation as a velxio custom chip.
 *
 * Source: Intel 8080 Programmer's Manual (1975) and Intel 8080A Data Sheet.
 * No third-party emulator code is used — this is written from the public
 * Intel specifications.
 *
 * Bus protocol: instruction-per-tick (collapses T1..T5 into one timer
 * fire). Each bus cycle drives the address bus, pulses SYNC with a status
 * byte on D0..D7, then either asserts DBIN to read or drives D and pulses
 * WR̅ to write. This is faithful to the real 8080's *observable* signals;
 * it is not strictly cycle-accurate.
 *
 * Pin contract (38 pins, see test_8080/README.md):
 *   A0..A15     output  16-bit address bus
 *   D0..D7      I/O     8-bit data bus (tristated when chip not driving)
 *   SYNC        output  Pulses high at start of every machine cycle
 *   DBIN        output  Active high — chip is reading the data bus
 *   WR          output  Active LOW — chip is writing the data bus
 *   INTE        output  Interrupt enable status (mirrors IME)
 *   WAIT        output  Asserted when chip stalled by READY=0
 *   HLDA        output  Acknowledges HOLD request
 *   READY       input   Active high — memory ready
 *   HOLD        input   Active high — bus request
 *   INT         input   Active high — interrupt request
 *   RESET       input   Active high — power-on reset
 *   PHI1, PHI2  input   Two-phase clock (informational; the chip's
 *                       internal pacing uses vx_timer_*)
 *   VCC, GND    power
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

/* ─── Status-byte encoding (real 8080) ──────────────────────────────────── */
#define STATUS_INTA   0x01  /* interrupt acknowledge */
#define STATUS_WO     0x02  /* "Write/Output" — HIGH on read, LOW on write */
#define STATUS_STACK  0x04
#define STATUS_HLTA   0x08
#define STATUS_OUT    0x10
#define STATUS_M1     0x20
#define STATUS_INP    0x40
#define STATUS_MEMR   0x80

#define ST_FETCH      (STATUS_M1   | STATUS_MEMR | STATUS_WO)  /* 0xA2 */
#define ST_MEMR       (STATUS_MEMR | STATUS_WO)                /* 0x82 */
#define ST_MEMW       (0)                                      /* 0x00 */
#define ST_STACKR     (STATUS_STACK | STATUS_MEMR | STATUS_WO) /* 0x86 */
#define ST_STACKW     (STATUS_STACK)                           /* 0x04 */
#define ST_INP        (STATUS_INP   | STATUS_WO)               /* 0x42 */
#define ST_OUT        (STATUS_OUT)                             /* 0x10 */
#define ST_INTA       (STATUS_M1    | STATUS_INTA | STATUS_WO) /* 0x23 */
#define ST_HLTA       (STATUS_HLTA  | STATUS_MEMR | STATUS_WO) /* 0x8A */

/* ─── Flag bit positions in the packed PSW byte ─────────────────────────── */
#define F_S    0x80
#define F_Z    0x40
#define F_AC   0x10
#define F_P    0x04
#define F_RES1 0x02   /* always 1 on 8080 */
#define F_CY   0x01

/* ─── State ─────────────────────────────────────────────────────────────── */
typedef struct {
    /* Pin handles — apin/dpin to avoid clash with register names a/d. */
    vx_pin apin[16];
    vx_pin dpin[8];
    vx_pin sync, dbin, wr, inte, wait_, hlda;
    vx_pin ready, hold, intn, reset;
    vx_pin phi1, phi2;
    vx_pin vcc, gnd;

    vx_timer cycle_timer;

    /* Registers — pairs aliased via union, low byte first (WASM is LE).
       8080 BC pair: B is high byte, C is low byte. With this layout,
       bc = (b << 8) | c. */
    union { struct { uint8_t c, b; }; uint16_t bc; };
    union { struct { uint8_t e, d; }; uint16_t de; };
    union { struct { uint8_t l, h; }; uint16_t hl; };
    uint16_t sp;
    uint16_t pc;
    uint8_t  acc;   /* accumulator A — named acc to avoid clash with .a array */

    /* Flags as separate bools — packed only when needed for PUSH PSW. */
    bool fs, fz, fac, fp, fcy;

    bool halted;
    bool ime;
    bool int_pending;
    bool reset_active;
} cpu_t;

static cpu_t G;

/* ─── Helpers ───────────────────────────────────────────────────────────── */
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
    return (v & 1) == 0;   /* 8080 P = 1 if EVEN parity */
}
static void set_szp(uint8_t v) {
    G.fs = (v & 0x80) != 0;
    G.fz = v == 0;
    G.fp = parity8(v);
}

/* Drive an 8-bit value out on D0..D7 with the data pins as outputs. */
static void drive_data(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.dpin[i], VX_OUTPUT);
        vx_pin_write(G.dpin[i], (v >> i) & 1);
    }
}
/* Release the data bus: switch D0..D7 back to input so other masters drive. */
static void release_data(void) {
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.dpin[i], VX_INPUT);
}
static void drive_addr(uint16_t a) {
    for (int i = 0; i < 16; i++) vx_pin_write(G.apin[i], (a >> i) & 1);
}
static uint8_t read_data(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.dpin[i])) v |= (1 << i);
    return v;
}

/* ─── Bus cycles ────────────────────────────────────────────────────────── */
/*
 * Real 8080 emits status during T1 by driving D0..D7 with the status byte
 * while SYNC is high. External 8228 latches it. We emit the same observable
 * pattern: drive data lines as output, raise SYNC, drop SYNC, release data
 * lines, then either DBIN-read or WR̅-write.
 */
static uint8_t bus_read(uint16_t addr, uint8_t status) {
    drive_addr(addr);
    drive_data(status);
    vx_pin_write(G.sync, 1);
    vx_pin_write(G.sync, 0);

    release_data();
    vx_pin_write(G.dbin, 1);
    uint8_t v = read_data();
    vx_pin_write(G.dbin, 0);
    return v;
}

static void bus_write(uint16_t addr, uint8_t data, uint8_t status) {
    drive_addr(addr);
    drive_data(status);
    vx_pin_write(G.sync, 1);
    vx_pin_write(G.sync, 0);

    drive_data(data);
    vx_pin_write(G.wr, 0);   /* WR̅ asserted */
    vx_pin_write(G.wr, 1);   /* rising edge — external latches data */
    /* We leave D pins as outputs holding `data` briefly; next bus cycle
       will switch them again. This matches real 8080's hold-time behavior. */
}

static uint8_t mem_read(uint16_t a)      { return bus_read(a, ST_MEMR); }
static void    mem_write(uint16_t a, uint8_t v) { bus_write(a, v, ST_MEMW); }
static uint8_t opcode_fetch(uint16_t a)  { return bus_read(a, ST_FETCH); }
static uint8_t stack_pop(void)           { uint8_t v = bus_read(G.sp, ST_STACKR); G.sp++; return v; }
static void    stack_push(uint8_t v)     { G.sp--; bus_write(G.sp, v, ST_STACKW); }

static uint8_t fetch8(void)  { return opcode_fetch(G.pc++); }
static uint8_t imm8(void)    { return mem_read(G.pc++); }
static uint16_t imm16(void)  { uint16_t lo = imm8(); return lo | ((uint16_t)imm8() << 8); }

static void push16(uint16_t v) { stack_push(v >> 8); stack_push(v & 0xff); }
static uint16_t pop16(void)    { uint8_t lo = stack_pop(); uint8_t hi = stack_pop(); return lo | ((uint16_t)hi << 8); }

/* ─── Register-by-code helpers (000=B,001=C,010=D,011=E,100=H,101=L,110=M,111=A) ─ */
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

/* ─── ALU ───────────────────────────────────────────────────────────────── */
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
    /* AC for SUB: set when there is NO borrow from bit 4, i.e. the low
       nibble subtraction did not underflow. */
    G.fac = (((G.acc & 0x0F) - (v & 0x0F) - cin) & 0x10) == 0;
    G.fcy = (r & 0x100) != 0;
    uint8_t r8 = (uint8_t)r;
    set_szp(r8);
    if (store) G.acc = r8;
}
static void alu_and(uint8_t v) {
    /* 8080 AC behaviour for AND: AC = (A | val) bit 3 — the actual 8080
       sets AC to ((A | val) & 0x08) >> 3 per the official Intel docs. */
    G.fac = ((G.acc | v) & 0x08) != 0;
    G.acc &= v;
    G.fcy = false;
    set_szp(G.acc);
}
static void alu_xor(uint8_t v) {
    G.acc ^= v;
    G.fcy = false;
    G.fac = false;
    set_szp(G.acc);
}
static void alu_or(uint8_t v) {
    G.acc |= v;
    G.fcy = false;
    G.fac = false;
    set_szp(G.acc);
}
static void alu_cmp(uint8_t v) {
    /* CMP: like SUB but discard result. Flags reflect A - v. */
    alu_sub(v, false, false);
}

static void alu_op(uint8_t op, uint8_t v) {
    switch (op) {
        case 0: alu_add(v, false); break; /* ADD */
        case 1: alu_add(v, true);  break; /* ADC */
        case 2: alu_sub(v, false, true);  break; /* SUB */
        case 3: alu_sub(v, true,  true);  break; /* SBB */
        case 4: alu_and(v); break;
        case 5: alu_xor(v); break;
        case 6: alu_or(v);  break;
        case 7: alu_cmp(v); break;
    }
}

static uint8_t inr(uint8_t v) {
    uint8_t r = v + 1;
    G.fac = (v & 0x0F) == 0x0F;
    set_szp(r);
    return r;
}
static uint8_t dcr(uint8_t v) {
    uint8_t r = v - 1;
    /* AC: set when no borrow from bit 4. Borrow happens iff low nibble
       of v was 0. So AC = (low_nibble != 0). */
    G.fac = (v & 0x0F) != 0;
    set_szp(r);
    return r;
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
    /* DAD: 16-bit add into HL, only CY is affected. */
    uint32_t r = (uint32_t)G.hl + v;
    G.fcy = r > 0xFFFF;
    G.hl = (uint16_t)r;
}

/* ─── Conditional helpers ───────────────────────────────────────────────── */
static bool cond_met(uint8_t cc) {
    switch (cc & 7) {
        case 0: return !G.fz;   /* NZ */
        case 1: return  G.fz;   /* Z  */
        case 2: return !G.fcy;  /* NC */
        case 3: return  G.fcy;  /* C  */
        case 4: return !G.fp;   /* PO (odd) */
        case 5: return  G.fp;   /* PE (even) */
        case 6: return !G.fs;   /* P  (positive) */
        case 7: return  G.fs;   /* M  (minus) */
    }
    return false;
}

/* ─── One-instruction step ──────────────────────────────────────────────── */
static void step(void) {
    /* Service interrupt if pending and IME. Real 8080 INT acknowledge:
       run an INTA bus cycle (status byte 0x23 = M1+INTA+WO̅), read the
       opcode that external hardware (8259 PIC or hard-wired logic)
       jams onto the data bus, and execute it. The opcode is typically
       a RST n (0xC7..0xFF); we support that fully. Other opcodes
       during INTA are documented to work too (e.g. CALL nnn) but
       require multi-byte fetches with INTA status — deferred. */
    if (G.int_pending && G.ime) {
        G.ime = false;
        G.int_pending = false;
        G.halted = false;
        vx_pin_write(G.inte, 0);

        /* Address driven on A0..A15 during INTA is undefined per
           datasheet; we drive PC for clarity. */
        uint8_t opcode = bus_read(G.pc, ST_INTA);

        if ((opcode & 0xC7) == 0xC7) {
            /* RST n */
            push16(G.pc);
            G.pc = (uint16_t)((opcode >> 3) & 7) * 8;
        }
        /* If opcode is a non-RST (e.g. CALL nnn = 0xCD), full fidelity
           would require additional INTA bus cycles to fetch the
           operand bytes — not implemented yet. Treat as a NOP. */
        return;
    }

    if (G.halted) {
        /* Real 8080 emits a HLTA bus cycle once on entry, then is silent
           until INTR or RESET. We approximate "silent" — no further bus
           activity — which matches the test's expectation. */
        return;
    }

    uint8_t op = fetch8();

    /* MOV r, r' — 0b01_DDD_SSS, except 0x76 = HLT */
    if ((op & 0xC0) == 0x40) {
        if (op == 0x76) { G.halted = true; return; }
        uint8_t v = reg_read_code(op);
        reg_write_code(op >> 3, v);
        return;
    }

    /* ALU op A, r — 0b10_OOO_SSS */
    if ((op & 0xC0) == 0x80) {
        alu_op((op >> 3) & 7, reg_read_code(op));
        return;
    }

    /* MVI r, n — 0b00_DDD_110 */
    if ((op & 0xC7) == 0x06) {
        reg_write_code(op >> 3, imm8());
        return;
    }

    /* INR r — 0b00_DDD_100 */
    if ((op & 0xC7) == 0x04) {
        uint8_t code = (op >> 3) & 7;
        reg_write_code(code, inr(reg_read_code(code)));
        return;
    }
    /* DCR r — 0b00_DDD_101 */
    if ((op & 0xC7) == 0x05) {
        uint8_t code = (op >> 3) & 7;
        reg_write_code(code, dcr(reg_read_code(code)));
        return;
    }

    /* RST n — 0b11_NNN_111 */
    if ((op & 0xC7) == 0xC7) {
        uint8_t n = (op >> 3) & 7;
        push16(G.pc);
        G.pc = (uint16_t)n * 8;
        return;
    }

    /* Conditional jumps — 0b11_CCC_010 */
    if ((op & 0xC7) == 0xC2) {
        uint16_t a = imm16();
        if (cond_met((op >> 3) & 7)) G.pc = a;
        return;
    }
    /* Conditional calls — 0b11_CCC_100 */
    if ((op & 0xC7) == 0xC4) {
        uint16_t a = imm16();
        if (cond_met((op >> 3) & 7)) { push16(G.pc); G.pc = a; }
        return;
    }
    /* Conditional returns — 0b11_CCC_000 */
    if ((op & 0xC7) == 0xC0) {
        if (cond_met((op >> 3) & 7)) G.pc = pop16();
        return;
    }

    /* Remaining opcodes — explicit dispatch. */
    switch (op) {
        case 0x00: /* NOP */ break;

        /* LXI rp, nn */
        case 0x01: G.bc = imm16(); break;
        case 0x11: G.de = imm16(); break;
        case 0x21: G.hl = imm16(); break;
        case 0x31: G.sp = imm16(); break;

        /* INX rp / DCX rp */
        case 0x03: G.bc++; break;
        case 0x13: G.de++; break;
        case 0x23: G.hl++; break;
        case 0x33: G.sp++; break;
        case 0x0B: G.bc--; break;
        case 0x1B: G.de--; break;
        case 0x2B: G.hl--; break;
        case 0x3B: G.sp--; break;

        /* DAD rp */
        case 0x09: dad(G.bc); break;
        case 0x19: dad(G.de); break;
        case 0x29: dad(G.hl); break;
        case 0x39: dad(G.sp); break;

        /* STAX / LDAX */
        case 0x02: mem_write(G.bc, G.acc); break;
        case 0x12: mem_write(G.de, G.acc); break;
        case 0x0A: G.acc = mem_read(G.bc); break;
        case 0x1A: G.acc = mem_read(G.de); break;

        /* STA / LDA */
        case 0x32: { uint16_t a = imm16(); mem_write(a, G.acc); break; }
        case 0x3A: { uint16_t a = imm16(); G.acc = mem_read(a); break; }

        /* SHLD / LHLD */
        case 0x22: { uint16_t a = imm16(); mem_write(a, G.l); mem_write(a+1, G.h); break; }
        case 0x2A: { uint16_t a = imm16(); G.l = mem_read(a); G.h = mem_read(a+1); break; }

        /* Rotates */
        case 0x07: { /* RLC */
            uint8_t b7 = (G.acc >> 7) & 1;
            G.acc = (G.acc << 1) | b7;
            G.fcy = b7;
            break;
        }
        case 0x0F: { /* RRC */
            uint8_t b0 = G.acc & 1;
            G.acc = (G.acc >> 1) | (b0 << 7);
            G.fcy = b0;
            break;
        }
        case 0x17: { /* RAL */
            uint8_t b7 = (G.acc >> 7) & 1;
            G.acc = (G.acc << 1) | (G.fcy ? 1 : 0);
            G.fcy = b7;
            break;
        }
        case 0x1F: { /* RAR */
            uint8_t b0 = G.acc & 1;
            G.acc = (G.acc >> 1) | ((G.fcy ? 1 : 0) << 7);
            G.fcy = b0;
            break;
        }

        case 0x27: daa(); break;
        case 0x2F: G.acc = ~G.acc; break;             /* CMA */
        case 0x37: G.fcy = true; break;               /* STC */
        case 0x3F: G.fcy = !G.fcy; break;             /* CMC */

        /* Immediate ALU — ADI/ACI/SUI/SBI/ANI/XRI/ORI/CPI */
        case 0xC6: alu_add(imm8(), false); break;
        case 0xCE: alu_add(imm8(), true);  break;
        case 0xD6: alu_sub(imm8(), false, true); break;
        case 0xDE: alu_sub(imm8(), true,  true); break;
        case 0xE6: alu_and(imm8()); break;
        case 0xEE: alu_xor(imm8()); break;
        case 0xF6: alu_or(imm8());  break;
        case 0xFE: alu_cmp(imm8()); break;

        /* Unconditional jump / call / return */
        case 0xC3: G.pc = imm16(); break;
        case 0xCD: { uint16_t a = imm16(); push16(G.pc); G.pc = a; break; }
        case 0xC9: G.pc = pop16(); break;
        case 0xE9: G.pc = G.hl; break;                /* PCHL */

        /* Stack — PUSH / POP rp */
        case 0xC5: stack_push(G.b); stack_push(G.c); break;
        case 0xD5: stack_push(G.d); stack_push(G.e); break;
        case 0xE5: stack_push(G.h); stack_push(G.l); break;
        case 0xF5: stack_push(G.acc); stack_push(pack_flags()); break;
        case 0xC1: G.c = stack_pop(); G.b = stack_pop(); break;
        case 0xD1: G.e = stack_pop(); G.d = stack_pop(); break;
        case 0xE1: G.l = stack_pop(); G.h = stack_pop(); break;
        case 0xF1: { unpack_flags(stack_pop()); G.acc = stack_pop(); break; }
        case 0xE3: { /* XTHL */
            uint8_t lo = mem_read(G.sp), hi = mem_read(G.sp + 1);
            mem_write(G.sp, G.l); mem_write(G.sp + 1, G.h);
            G.l = lo; G.h = hi;
            break;
        }
        case 0xF9: G.sp = G.hl; break;                /* SPHL */
        case 0xEB: { /* XCHG */
            uint16_t t = G.de; G.de = G.hl; G.hl = t; break;
        }

        /* I/O — IN / OUT mirror port number on both halves of address bus. */
        case 0xDB: { /* IN n */
            uint8_t port = imm8();
            G.acc = bus_read(((uint16_t)port << 8) | port, ST_INP);
            break;
        }
        case 0xD3: { /* OUT n */
            uint8_t port = imm8();
            bus_write(((uint16_t)port << 8) | port, G.acc, ST_OUT);
            break;
        }

        /* Interrupt control */
        case 0xFB: G.ime = true;  vx_pin_write(G.inte, 1); break;
        case 0xF3: G.ime = false; vx_pin_write(G.inte, 0); break;

        default:
            /* Undocumented / unimplemented — treat as NOP. Real 8080 has a
               handful of duplicate opcodes (e.g. 0x08, 0x10, 0x18 = NOP
               aliases) which is fine to ignore here. */
            break;
    }
}

/* ─── Reset and clock callbacks ─────────────────────────────────────────── */
static void reset_state(void) {
    G.pc = 0;
    G.sp = 0;
    G.acc = 0; G.b = G.c = G.d = G.e = G.h = G.l = 0;
    G.fs = G.fz = G.fac = G.fp = false;
    G.fcy = false;
    G.halted = false;
    G.ime = false;
    G.int_pending = false;

    vx_pin_write(G.sync, 0);
    vx_pin_write(G.dbin, 0);
    vx_pin_write(G.wr,   1);  /* WR̅ idle = HIGH */
    vx_pin_write(G.inte, 0);
    vx_pin_write(G.wait_, 0);
    vx_pin_write(G.hlda, 0);
    release_data();
}

static void on_reset(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) {
        G.reset_active = true;
        reset_state();
    } else {
        G.reset_active = false;
    }
}

static void on_int(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (value) G.int_pending = true;
}

static void on_clock(void* user_data) {
    (void)user_data;
    if (G.reset_active) return;
    /* READY low → wait state. Active high. */
    if (vx_pin_read(G.ready) == 0) {
        vx_pin_write(G.wait_, 1);
        return;
    }
    vx_pin_write(G.wait_, 0);
    /* HOLD high → bus release (ack and idle). */
    if (vx_pin_read(G.hold)) {
        vx_pin_write(G.hlda, 1);
        return;
    }
    vx_pin_write(G.hlda, 0);

    step();
}

/* ─── Setup ─────────────────────────────────────────────────────────────── */
void chip_setup(void) {
    char name[8];
    /* A0..A15 outputs */
    for (int i = 0; i < 16; i++) {
        name[0]='A'; if (i<10) { name[1]='0'+i; name[2]=0; }
        else        { name[1]='1'; name[2]='0'+(i-10); name[3]=0; }
        G.apin[i] = vx_pin_register(name, VX_OUTPUT_LOW);
    }
    /* D0..D7 — start as input (chip not driving) */
    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.dpin[i] = vx_pin_register(name, VX_INPUT);
    }

    G.sync  = vx_pin_register("SYNC",  VX_OUTPUT_LOW);
    G.dbin  = vx_pin_register("DBIN",  VX_OUTPUT_LOW);
    G.wr    = vx_pin_register("WR",    VX_OUTPUT_HIGH); /* idle high */
    G.inte  = vx_pin_register("INTE",  VX_OUTPUT_LOW);
    G.wait_ = vx_pin_register("WAIT",  VX_OUTPUT_LOW);
    G.hlda  = vx_pin_register("HLDA",  VX_OUTPUT_LOW);

    G.ready = vx_pin_register("READY", VX_INPUT);
    G.hold  = vx_pin_register("HOLD",  VX_INPUT);
    G.intn  = vx_pin_register("INT",   VX_INPUT);
    G.reset = vx_pin_register("RESET", VX_INPUT);
    G.phi1  = vx_pin_register("PHI1",  VX_INPUT);
    G.phi2  = vx_pin_register("PHI2",  VX_INPUT);
    G.vcc   = vx_pin_register("VCC",   VX_INPUT);
    G.gnd   = vx_pin_register("GND",   VX_INPUT);

    reset_state();

    vx_pin_watch(G.reset, VX_EDGE_BOTH,    on_reset, 0);
    vx_pin_watch(G.intn,  VX_EDGE_RISING,  on_int,   0);

    /* Timer-driven step. 500 ns period == 2 MHz pseudo-clock.
       One instruction per fire — simple, deterministic, plenty fast for tests. */
    G.cycle_timer = vx_timer_create(on_clock, 0);
    vx_timer_start(G.cycle_timer, 500, true);
}
