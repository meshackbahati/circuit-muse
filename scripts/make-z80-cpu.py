"""Generate z80-cpu.c from z80.c — strip external bus pins, swap in internal
RAM + ROM + memory-mapped LED/BTN/UART peripherals.

Run from repo root: `python scripts/make-z80-cpu.py`.
"""
from __future__ import annotations

import re
from pathlib import Path

SRC = Path('frontend/src/components/customChips/examples/intel/z80.c')
OUT = Path('frontend/src/components/customChips/examples/intel/z80-cpu.c')

src = SRC.read_text(encoding='utf-8')


# ─── helpers ─────────────────────────────────────────────────────────────
def replace_func(s: str, signature: str, body_replacement: str) -> str:
    """Replace a C function definition (signature + braced body) with a new
    one-liner body. Uses a brace-depth scanner so nested `{` don't trip us."""
    idx = s.find(signature)
    if idx < 0:
        return s
    open_b = s.find('{', idx + len(signature))
    if open_b < 0:
        return s
    depth = 1
    i = open_b + 1
    while i < len(s) and depth > 0:
        if s[i] == '{':
            depth += 1
        elif s[i] == '}':
            depth -= 1
        i += 1
    return s[:idx] + signature + ' { ' + body_replacement + ' }' + s[i:]


# ─── 1) Replace top-of-file comment ──────────────────────────────────────
src = re.sub(
    r'/\*\n \* Zilog Z80 emulator.+?\*/\n',
    '''/*
 * z80-cpu.c — programmable Zilog Z80 chip for Velxio.
 *
 * Generated from z80.c by scripts/make-z80-cpu.py. The Z80 CPU emulation
 * is the same clean-room implementation validated by test_z80/z80.test.js
 * (passes ZEXDOC end-to-end). The external pin/bus protocol is replaced
 * with internal RAM + ROM + memory-mapped LED/BTN/UART peripherals so the
 * chip is drop-and-go on the Velxio canvas.
 *
 * The ROM image is loaded at chip_setup via vx_rom_size / vx_rom_read,
 * sourced from the chip's romBytes property (typed in a project file,
 * compiled by POST /api/compile-rom).
 *
 * Memory map:
 *   0x0000..0x7FFF  ROM      (up to 32 KB, external)
 *   0x8000..0xBFFF  RAM      (16 KB internal)
 *   0xC000          LED_OUT
 *   0xC001          UART_DATA
 *   0xC002          UART_STAT  (bit 0 = TX ready, bit 1 = RX has byte)
 *   0xC003          BTN_IN
 *   0xC004          EDGE_FLAGS (read = rising-edge latch; cleared on read)
 *
 * IN/OUT port instructions mirror MMIO at 0xC000+port_lo.
 */
''',
    src,
    count=1,
    flags=re.DOTALL,
)


# ─── 2) Strip pin fields from cpu_t ──────────────────────────────────────
src = re.sub(
    r'    /\* Pins \*/\n'
    r'    vx_pin apin\[16\], dpin\[8\];\n'
    r'    vx_pin m1, mreq, iorq, rd, wr, rfsh, halt_, wait_;\n'
    r'    vx_pin intn, nmi, reset_, busreq, busack, clk;\n'
    r'    vx_pin vcc, gnd;\n'
    r'    vx_timer cycle_timer;\n',
    '    vx_timer cycle_timer;\n',
    src,
)


# ─── 3) Reduce the four pin-driving helpers to no-ops ───────────────────
src = replace_func(src, 'static void drive_addr(uint16_t a)',    '(void)a;')
src = replace_func(src, 'static void release_data(void)',         '/* noop */')
src = replace_func(src, 'static uint8_t read_data(void)',         'return 0;')
src = replace_func(src, 'static void drive_data(uint8_t v)',      '(void)v;')


# ─── 4) Strip every remaining vx_pin_* on G.<bus pin> ───────────────────
PIN_NAMES = (
    r'(?:m1|mreq|iorq|rd|wr|rfsh|halt_|wait_|intn|nmi|reset_|busreq|busack|clk|vcc|gnd'
    r'|apin\[[^\]]*\]|dpin\[[^\]]*\])'
)
src = re.sub(rf'^\s*vx_pin_write\(G\.{PIN_NAMES}\s*,[^;]*;\n', '', src, flags=re.MULTILINE)
src = re.sub(rf'^\s*vx_pin_set_mode\(G\.{PIN_NAMES}\s*,[^;]*;\n', '', src, flags=re.MULTILINE)
src = re.sub(r'vx_pin_read\(G\.busreq\)', '1', src)
src = re.sub(r'vx_pin_read\(G\.wait_\)',  '1', src)
src = re.sub(r'vx_pin_read\(G\.(intn|nmi|reset_)\)', '0', src)
src = re.sub(r'\s*vx_pin_watch\(G\.(reset_|intn|nmi)[^;]*;\n', '\n', src)


# ─── 5) Drop the original pin-registration loops + lines (we add our own) ──
src = re.sub(
    r'/\* A0\.\.A15.+?G\.apin\[i\] = vx_pin_register\([^)]*\);\s*}\n',
    '', src, flags=re.DOTALL,
)
src = re.sub(
    r'/\* D0\.\.D7.+?G\.dpin\[i\] = vx_pin_register\([^)]*\);\s*}\n',
    '', src, flags=re.DOTALL,
)
src = re.sub(
    rf'    G\.{PIN_NAMES}\s*=\s*vx_pin_register\([^)]*\);\s*\n',
    '', src,
)


# ─── 6) Replace each bus function in place ──────────────────────────────
src = replace_func(
    src, 'static uint8_t opcode_fetch(uint16_t addr)',
    'G.r = (G.r & 0x80) | ((G.r + 1) & 0x7F); return bus_mem_read(addr);',
)
src = replace_func(
    src, 'static uint8_t mem_read(uint16_t addr)',
    'return bus_mem_read(addr);',
)
src = replace_func(
    src, 'static void mem_write(uint16_t addr, uint8_t data)',
    'bus_mem_write(addr, data);',
)
src = replace_func(
    src, 'static uint8_t io_read(uint16_t addr)',
    'return bus_mem_read(0xC000 + (addr & 0xFF));',
)
src = replace_func(
    src, 'static void io_write(uint16_t addr, uint8_t data)',
    'bus_mem_write(0xC000 + (addr & 0xFF), data);',
)


# ─── 7) Inject helper state + bus_mem_read / bus_mem_write + UART hooks ──
helpers = '''
/* ─── External ROM + internal RAM + MMIO state ───────────────────────── */
#define ROM_MAX         0x8000
#define RAM_BASE        0x8000
/* RAM spans 0x8000-0xFFFF (32 KB) so SDCC's default crt0 — which sets SP to
   0x0000 and makes its first push at 0xFFFF — lands in real RAM. Without this
   a plain C program crashes in crt0 (before main) on this chip. The MMIO
   window below is carved out of the RAM range and checked first. */
#define RAM_SIZE        0x8000
#define MMIO_BASE       0xC000
#define MMIO_END        0xC0FF
#define MMIO_LED_OUT    0xC000
#define MMIO_UART_DATA  0xC001
#define MMIO_UART_STAT  0xC002
#define MMIO_BTN_IN     0xC003
#define MMIO_EDGE_FLAGS 0xC004

static uint8_t  ROMBUF[ROM_MAX];
static uint32_t ROMSZ = 0;
static uint8_t  RAMBUF[RAM_SIZE];

#define RX_BUFSZ 64
static uint8_t  rx_buf[RX_BUFSZ];
static volatile uint32_t rx_head = 0, rx_tail = 0;
static bool rx_has(void) { return rx_head != rx_tail; }
static uint8_t rx_pop(void) {
    if (rx_head == rx_tail) return 0;
    uint8_t v = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1) % RX_BUFSZ;
    return v;
}
static void rx_push(uint8_t b) {
    uint32_t n = (rx_head + 1) % RX_BUFSZ;
    if (n == rx_tail) return;
    rx_buf[rx_head] = b; rx_head = n;
}

static vx_pin g_led[8];
static vx_pin g_btn[8];
static volatile uint8_t edge_latch = 0;
static vx_uart g_uart;

static void on_btn_rising(void* ud, vx_pin pin, int value) {
    (void)pin; (void)value;
    uint32_t idx = (uintptr_t)ud;
    if (idx < 8) edge_latch |= (uint8_t)(1u << idx);
}
static uint8_t read_btn_bitmap(void) {
    uint8_t b = 0;
    for (int i = 0; i < 8; i++) if (vx_pin_read(g_btn[i])) b |= (uint8_t)(1u << i);
    return b;
}
static void drive_leds(uint8_t v) {
    for (int i = 0; i < 8; i++) vx_pin_write(g_led[i], (v >> i) & 1);
}

static uint8_t bus_mem_read(uint16_t addr) {
    if (addr < ROMSZ) return ROMBUF[addr];
    /* MMIO window has priority over RAM (it is carved out of the RAM range). */
    if (addr >= MMIO_BASE && addr <= MMIO_END) {
        switch (addr) {
            case MMIO_UART_DATA: return rx_has() ? rx_pop() : 0;
            case MMIO_UART_STAT: { uint8_t s = 0x01; if (rx_has()) s |= 0x02; return s; }
            case MMIO_BTN_IN:    return read_btn_bitmap();
            case MMIO_EDGE_FLAGS: { uint8_t v = edge_latch; edge_latch = 0; return v; }
            default: return 0xFF;
        }
    }
    if (addr >= RAM_BASE) return RAMBUF[addr - RAM_BASE];  /* 0x8000-0xFFFF */
    return 0xFF;
}

static void bus_mem_write(uint16_t addr, uint8_t v) {
    /* MMIO window has priority over RAM (it is carved out of the RAM range). */
    if (addr >= MMIO_BASE && addr <= MMIO_END) {
        switch (addr) {
            case MMIO_LED_OUT:   drive_leds(v); return;
            case MMIO_UART_DATA: vx_uart_write(g_uart, &v, 1); return;
            default: return;
        }
    }
    if (addr >= RAM_BASE) {  /* 0x8000-0xFFFF */
        RAMBUF[addr - RAM_BASE] = v; return;
    }
}

static void on_uart_rx(void* ud, uint8_t byte) { (void)ud; rx_push(byte); }
static void on_uart_tx_done(void* ud) { (void)ud; }

'''
# Insert just before the first use of opcode_fetch so bus_mem_read is defined
# before opcode_fetch references it.
src = src.replace('static uint8_t opcode_fetch', helpers + 'static uint8_t opcode_fetch', 1)


# ─── 8) Replace on_clock + chip_setup with chip-specific versions ───────
src = replace_func(
    src, 'static void on_clock(void* user_data)',
    '(void)user_data; if (ROMSZ == 0) return; for (int i = 0; i < 200; i++) step();',
)

new_setup = (
    'char name[8]; '
    'for (int i = 0; i < 8; i++) { '
    'name[0] = \'L\'; name[1] = \'E\'; name[2] = \'D\'; '
    'name[3] = (char)(\'0\' + i); name[4] = 0; '
    'g_led[i] = vx_pin_register(name, VX_OUTPUT_LOW); '
    '} '
    'for (int i = 0; i < 8; i++) { '
    'name[0] = \'B\'; name[1] = \'T\'; name[2] = \'N\'; '
    'name[3] = (char)(\'0\' + i); name[4] = 0; '
    'g_btn[i] = vx_pin_register(name, VX_INPUT_PULLDOWN); '
    'vx_pin_watch(g_btn[i], VX_EDGE_RISING, on_btn_rising, (void*)(uintptr_t)i); '
    '} '
    'vx_uart_config cfg = { '
    '.rx = vx_pin_register("RX", VX_INPUT), '
    '.tx = vx_pin_register("TX", VX_OUTPUT_HIGH), '
    '.baud_rate = 9600, '
    '.on_rx_byte = on_uart_rx, '
    '.on_tx_done = on_uart_tx_done, '
    '.user_data = 0, '
    '}; '
    'g_uart = vx_uart_attach(&cfg); '
    'vx_pin_register("VCC", VX_INPUT); '
    'vx_pin_register("GND", VX_INPUT); '
    'uint32_t n = vx_rom_size(); '
    'if (n > ROM_MAX) n = ROM_MAX; '
    'if (n > 0) { vx_rom_read(0, ROMBUF, n); ROMSZ = n; } '
    'else { vx_log("z80-cpu: no romBytes attached. Compile a .s/.hex/.bin file."); } '
    'reset_state(); '
    'G.cycle_timer = vx_timer_create(on_clock, 0); '
    'vx_timer_start(G.cycle_timer, 1000000, true); '
)
src = replace_func(src, 'void chip_setup(void)', new_setup)


OUT.write_text(src, encoding='utf-8')
print(f'wrote {OUT} ({len(src)} chars)')
