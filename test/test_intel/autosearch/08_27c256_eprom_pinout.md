# 27C256 EPROM — pinout reference for `rom-32k.c`

The 27C256 (and the older 2764/27256) is the canonical 32 KB EPROM
used on virtually every 8-bit retro-computer of the late 1970s–80s.
Datasheet is mirrored extensively (Atmel, ST, AMD, Microchip — all
permissively redistributable spec sheets, dating from the 1980s).

## Package: 28-pin DIP

| Pin (real) | Name | Direction | Notes |
|------------|------|-----------|-------|
| 1          | VPP  | input     | Programming voltage (12V/12.75V). **Tied to VCC for read mode.** |
| 2–10       | A12, A7, A6, A5, A4, A3, A2, A1, A0 | input | Address — physical pin order is non-trivial |
| 11–13, 15–19 | D0..D7 | I/O | Data bus (output during read; input during programming) |
| 14         | GND  | power     | |
| 20         | CE̅   | input     | Active-low chip enable |
| 21         | A10  | input     | |
| 22         | OE̅   | input     | Active-low output enable |
| 23–27      | A11, A9, A8, A13, A14 | input | Address remainder |
| 28         | VCC  | power     | +5 V |

## Read-mode logic (from any 27C256 datasheet, "Operating Modes" section)

| CE̅ | OE̅ | VPP  | Mode             | Output (D0..D7) |
|-----|-----|------|------------------|------------------|
| H   | x   | VCC  | **Standby**      | High-Z (tristate) |
| L   | H   | VCC  | **Output disable** | High-Z |
| L   | L   | VCC  | **Read**         | data byte from `mem[A14..A0]` |

Velxio is digital-only with no tristate state, so "High-Z" is modelled
by switching D pins to `VX_INPUT` (the pin retains its last value but
the chip is not driving). Tests assume that when CE̅ or OE̅ is
deasserted, the chip will not contend with another driver — verified
by `rom-32k.test.js`'s "tristate" assertions.

## Mapping for our `rom-32k.c`

We collapse the 28-pin package to a clean 27-named-pin model: the
test's pin contract names every signal and ignores the physical pin
ordering. Programming-mode pins (PGM̅, VPP behaviour) are out of
scope — this is a read-only model.

The first 16 bytes of the embedded ROM image are the test fixture
`{0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x11, 0x22, 0x33,
0x44, 0x55, 0x66, 0x77, 0x88}`; everything else is `0xFF` to mirror
real-EPROM erased state.
