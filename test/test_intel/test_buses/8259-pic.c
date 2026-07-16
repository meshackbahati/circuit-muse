/*
 * Intel 8259 Programmable Interrupt Controller — single-mode subset.
 *
 * The 8259 is a 28-pin DIP that funnels up to 8 interrupt request
 * lines (IRQ0..IRQ7) onto a CPU's single INTR line, driving an
 * 8086/8080-style INTA acknowledge cycle to deliver an interrupt
 * vector byte on the data bus. Multiple 8259s can be cascaded for up
 * to 64 IRQs — we implement single-master only.
 *
 * Source: Intel 8259A Datasheet (public mirror, bitsavers.org).
 *
 * Pin contract (28-pin DIP):
 *   D0..D7    bidirectional 8-bit data bus
 *   A0        input — register select (0 = ICW1/OCW2/OCW3, 1 = ICW2..4 / OCW1 / IMR)
 *   CS̅        input — active-low chip enable
 *   RD̅        input — active-low read strobe
 *   WR̅        input — active-low write strobe
 *   IRQ0..7   inputs — active-high requests (edge or level depending on ICW1)
 *   INT       output — driven HIGH when an unmasked IRQ is pending
 *   INTA̅      input — active-low acknowledge from CPU
 *   CAS0..2   I/O — cascade lines (NOT implemented)
 *   SP/EN̅     I/O — slave/buffer-enable (master mode only here)
 *   VCC, GND  power
 *
 * Init sequence:
 *   ICW1 (A0=0, bit 4 = 1): bit 0 = "ICW4 needed"; bit 1 = single (1)/
 *     cascaded (0); bit 3 = level/edge triggered.
 *   ICW2 (A0=1): vector base byte. IRQ n vector = base + n.
 *   ICW3 (A0=1): cascade config — skipped when ICW1 bit 1 = 1 (single).
 *   ICW4 (A0=1): mode bits (8086 mode if bit 0 = 1) — skipped when
 *     ICW1 bit 0 = 0.
 * Then enters operating mode:
 *   OCW1 (A0=1): write to IMR (interrupt mask).
 *   OCW2 (A0=0, bits 4..3 = 00): EOI commands — non-specific (0x20)
 *     or specific (0x60..0x67).
 *   OCW3 (A0=0, bits 4..3 = 01): read IRR/ISR select.
 *
 * INTA cycle (8086 mode, 2 INTA̅ pulses):
 *   First INTA̅↓ — chip locks the highest-priority pending IRR bit,
 *     sets ISR bit, clears IRR bit; drives 0xFF on the data bus
 *     (manual says undefined; we drive 0xFF as is conventional).
 *   Second INTA̅↓ — chip drives the vector byte (base + IRQ#).
 *   We approximate by always driving the vector on every INTA̅↓ —
 *   simpler and works fine in tests.
 *
 * EOI: OCW2 with bit 5 = 1 clears the highest-priority ISR bit.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

typedef enum {
    INIT_NEED_ICW1 = 0,
    INIT_NEED_ICW2,
    INIT_NEED_ICW3,
    INIT_NEED_ICW4,
    INIT_RUNNING,
} init_state_t;

typedef struct {
    vx_pin d[8];
    vx_pin a0, cs, rd, wr;
    vx_pin irq[8];
    vx_pin intp;          /* INT output to CPU */
    vx_pin inta;          /* INTA̅ input from CPU */
    vx_pin cas[3];        /* cascade — not used */
    vx_pin sp_en;         /* not used */
    vx_pin vcc, gnd;

    init_state_t init_state;
    uint8_t  icw1;        /* saved init word 1 */
    uint8_t  vector_base; /* ICW2 */
    bool     single;      /* ICW1 bit 1 */
    bool     need_icw4;   /* ICW1 bit 0 */
    uint8_t  imr;         /* mask: bit n = 1 → IRQ n masked */
    uint8_t  irr;         /* pending requests */
    uint8_t  isr;         /* in-service */
    uint8_t  read_select; /* 0 = read IRR on next A0=0 read, 1 = ISR */

    int      wr_last;
    int      inta_last;
    bool     driving_d;
} chip_t;

static chip_t G;

/* ─── D-bus helpers ─────────────────────────────────────────────────────── */
static uint8_t read_d_byte(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(G.d[i])) v |= (1u << i);
    return v;
}
static void drive_d(uint8_t v) {
    for (int i = 0; i < 8; i++) {
        vx_pin_set_mode(G.d[i], VX_OUTPUT);
        vx_pin_write(G.d[i], (v >> i) & 1);
    }
    G.driving_d = true;
}
static void release_d(void) {
    if (!G.driving_d) return;
    for (int i = 0; i < 8; i++) vx_pin_set_mode(G.d[i], VX_INPUT);
    G.driving_d = false;
}

/* Find highest-priority bit (bit 0 = highest, per fully-nested mode). */
static int highest_priority(uint8_t bits) {
    for (int i = 0; i < 8; i++) if (bits & (1u << i)) return i;
    return -1;
}

/* Update INT output: HIGH iff there's an unmasked IRR bit higher in
   priority than any current ISR bit. */
static void update_int(void) {
    uint8_t pending = G.irr & ~G.imr;
    if (pending == 0) {
        vx_pin_write(G.intp, 0);
        return;
    }
    int pend_top = highest_priority(pending);
    int isr_top = highest_priority(G.isr);
    /* Higher priority = lower bit index. INT iff pending priority is
       strictly more important than current in-service. */
    if (isr_top < 0 || pend_top < isr_top) {
        vx_pin_write(G.intp, 1);
    } else {
        vx_pin_write(G.intp, 0);
    }
}

/* ─── Pin watchers ──────────────────────────────────────────────────────── */

static void on_irq(void* user_data, vx_pin pin, int value) {
    int n = (int)(intptr_t)user_data;
    (void)pin;
    if (value) {
        G.irr |= (uint8_t)(1u << n);
        update_int();
    }
    /* For edge-triggered mode (ICW1 bit 3 = 0), level transitions
       from low to high are what set IRR. Level mode would re-arm
       on every poll — we don't implement that. */
}

static void on_inta(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (G.inta_last == 1 && value == 0) {
        /* INTA̅ falling — drive vector for the highest-priority pending
           unmasked IRQ. Set ISR bit, clear IRR bit, deassert INT. */
        uint8_t pending = G.irr & ~G.imr;
        int n = highest_priority(pending);
        if (n >= 0) {
            G.isr |= (uint8_t)(1u << n);
            G.irr &= (uint8_t)~(1u << n);
            uint8_t vec = (uint8_t)(G.vector_base + n);
            drive_d(vec);
            vx_pin_write(G.intp, 0);
        } else {
            /* Spurious — drive vector base + 7 per Intel app note. */
            drive_d((uint8_t)(G.vector_base + 7));
        }
    } else if (value == 1) {
        release_d();
    }
    G.inta_last = value;
}

static void handle_write(uint8_t a0, uint8_t v) {
    if (a0 == 0) {
        if (v & 0x10) {
            /* ICW1 — entering init mode. */
            G.icw1 = v;
            G.single = (v & 0x02) != 0;
            G.need_icw4 = (v & 0x01) != 0;
            G.imr = 0xFF;
            G.irr = 0;
            G.isr = 0;
            G.init_state = INIT_NEED_ICW2;
            update_int();
            return;
        }
        if ((v & 0x18) == 0x00) {
            /* OCW2 — EOI / priority commands. */
            uint8_t cmd = v & 0xE0;
            if (cmd == 0x20) {
                /* Non-specific EOI: clear highest-priority ISR bit. */
                int top = highest_priority(G.isr);
                if (top >= 0) G.isr &= (uint8_t)~(1u << top);
            } else if (cmd == 0x60) {
                /* Specific EOI — bits 0..2 are IRQ#. */
                G.isr &= (uint8_t)~(1u << (v & 7));
            }
            update_int();
        } else if ((v & 0x18) == 0x08) {
            /* OCW3 — read register select. */
            if ((v & 0x02) != 0) {
                G.read_select = (v & 0x01);
            }
        }
        return;
    }
    /* A0 = 1 */
    switch (G.init_state) {
        case INIT_NEED_ICW2:
            G.vector_base = (v & 0xF8);   /* low 3 bits ignored in 8086 mode */
            if (G.single) {
                G.init_state = G.need_icw4 ? INIT_NEED_ICW4 : INIT_RUNNING;
            } else {
                G.init_state = INIT_NEED_ICW3;
            }
            break;
        case INIT_NEED_ICW3:
            G.init_state = G.need_icw4 ? INIT_NEED_ICW4 : INIT_RUNNING;
            break;
        case INIT_NEED_ICW4:
            G.init_state = INIT_RUNNING;
            break;
        case INIT_RUNNING:
        case INIT_NEED_ICW1:
            /* OCW1 — write IMR. */
            G.imr = v;
            update_int();
            break;
    }
}

static void on_wr(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { G.wr_last = value; return; }
    if (G.wr_last == 0 && value == 1) {
        /* Latch on rising edge */
        uint8_t a0 = vx_pin_read(G.a0) ? 1 : 0;
        handle_write(a0, read_d_byte());
    }
    G.wr_last = value;
}

static void on_rd(void* user_data, vx_pin pin, int value) {
    (void)user_data; (void)pin;
    if (vx_pin_read(G.cs) != 0) { release_d(); return; }
    if (value == 0) {
        uint8_t a0 = vx_pin_read(G.a0) ? 1 : 0;
        if (a0 == 0) {
            drive_d(G.read_select ? G.isr : G.irr);
        } else {
            drive_d(G.imr);
        }
    } else {
        release_d();
    }
}

void chip_setup(void) {
    char name[6];

    for (int i = 0; i < 8; i++) {
        name[0]='D'; name[1]='0'+i; name[2]=0;
        G.d[i] = vx_pin_register(name, VX_INPUT);
    }
    for (int i = 0; i < 8; i++) {
        name[0]='I'; name[1]='R'; name[2]='Q'; name[3]='0'+i; name[4]=0;
        G.irq[i] = vx_pin_register(name, VX_INPUT);
    }
    G.a0    = vx_pin_register("A0",   VX_INPUT);
    G.cs    = vx_pin_register("CS",   VX_INPUT);
    G.rd    = vx_pin_register("RD",   VX_INPUT);
    G.wr    = vx_pin_register("WR",   VX_INPUT);
    G.intp  = vx_pin_register("INT",  VX_OUTPUT_LOW);
    G.inta  = vx_pin_register("INTA", VX_INPUT);
    G.cas[0]= vx_pin_register("CAS0", VX_INPUT);
    G.cas[1]= vx_pin_register("CAS1", VX_INPUT);
    G.cas[2]= vx_pin_register("CAS2", VX_INPUT);
    G.sp_en = vx_pin_register("SPEN", VX_INPUT);
    G.vcc   = vx_pin_register("VCC",  VX_INPUT);
    G.gnd   = vx_pin_register("GND",  VX_INPUT);

    G.init_state = INIT_NEED_ICW1;
    G.imr = 0xFF;
    G.irr = G.isr = 0;
    G.vector_base = 0;
    G.read_select = 0;
    G.wr_last = 1;
    G.inta_last = 1;
    G.driving_d = false;

    for (int i = 0; i < 8; i++) {
        vx_pin_watch(G.irq[i], VX_EDGE_RISING, on_irq, (void*)(intptr_t)i);
    }
    vx_pin_watch(G.wr,   VX_EDGE_BOTH, on_wr,   0);
    vx_pin_watch(G.rd,   VX_EDGE_BOTH, on_rd,   0);
    vx_pin_watch(G.inta, VX_EDGE_BOTH, on_inta, 0);
}
