# test_4004 — Intel 4004 as a velxio custom chip

See [../autosearch/02_intel_chips_overview.md](../autosearch/02_intel_chips_overview.md#intel-4004-1971)
for the chip's specs and [../autosearch/03_emulation_strategy.md](../autosearch/03_emulation_strategy.md)
for how the bus phases map onto velxio's reactive callbacks.

## Status

✅ **Implemented (bus skeleton).** 4/11 active tests pass; 7 are
`it.todo` deferred to ISA-implementation phase. ~150 LOC clean-room
in `4004.c` compiled to `fixtures/4004.wasm`.

Validated against Intel MCS-4 User's Manual (Feb 1973) — PDF at
`autosearch/pdfs/mcs4_users_manual.pdf`. Cross-checked the 8-phase
frame timing and pin-out against `markablov/i40xx` (MIT, JS) and
`Kostu96/K4004` (MIT, C++).

What works:
- Full 16-pin DIP contract (D0..D3, SYNC, RESET, TEST, CMROM,
  CMRAM0..3, CLK1, CLK2, VDD, VSS).
- 8-phase instruction frame (A1, A2, A3, M1, M2, X1, X2, X3) at
  ~740 kHz nominal clock (1351 ns per phase).
- SYNC pulses high at A1, low at A2 onwards — once per 8-clock cycle.
- Address bus walk: D0..D3 = PC[3:0] in A1, PC[7:4] in A2, PC[11:8]
  in A3 (low-nibble first per [M4] Fig. 2 p. 6).
- CMROM strobed high during M1 (instruction fetch).
- PC increments at end of every cycle (NOP-equivalent — every fetched
  opcode is treated as a NOP for now).
- RESET behaviour: held high clears all state per [M4] §III.A.5 p. 9.

Deferred until ISA implementation phase:
- All 46 4004 instructions (currently only NOP behaviour). Tracked in
  `it.todo` for LDM, ADD, JCN, FIM, JMS, BBL.
- SRC chip-select latching with CMRAMᵢ strobe at X2/X3.
- I/O group (WRM, RDM, WRR, etc.) at 0xE0..0xEF.
- Accumulator group (CLB, CLC, IAC, ..., DAA) at 0xF0..0xFD.
- Busicom 141-PF integration test (the canonical 4004 demo).

## Pin contract (16-pin DIP, real silicon)

| Pin | Name      | Dir   | Notes |
| --- | --------- | ----- | ----- |
| 1   | D0        | I/O   | Multiplexed nibble bus |
| 2   | D1        | I/O   | |
| 3   | D2        | I/O   | |
| 4   | D3        | I/O   | |
| 5   | VSS       | power | GND |
| 6   | CLK1      | in    | Phase 1 clock |
| 7   | CLK2      | in    | Phase 2 clock |
| 8   | SYNC      | out   | Cycle marker |
| 9   | RESET     | in    | |
| 10  | TEST      | in    | Conditional-jump input |
| 11  | CM-RAM3   | out   | RAM bank select |
| 12  | CM-RAM2   | out   | |
| 13  | CM-RAM1   | out   | |
| 14  | CM-RAM0   | out   | |
| 15  | CM-ROM    | out   | ROM strobe |
| 16  | VDD       | power | +5 V (real chip wanted +5/-10 V split — collapsed for digital sim) |

**Pin-numbering note:** the table above orders pins logically, not in
the physical 1–16 DIP layout. Cross-check against an Intel 4004
datasheet before finalising the `.chip.json`. Logged in
[../autosearch/05_open_questions.md](../autosearch/05_open_questions.md).

## Bus model summary

8-cycle instruction frame. Each CLK1+CLK2 pair = one cycle. Within an
8-cycle frame the chip drives:

| Cycle | What's on D0..D3 | Direction |
| ----- | ---------------- | --------- |
| A1    | addr nibble 0    | output    |
| A2    | addr nibble 1    | output    |
| A3    | addr nibble 2    | output    |
| M1    | opcode hi nibble | input (read from ROM) |
| M2    | opcode lo nibble | input |
| X1    | data / operand   | varies    |
| X2    | data / operand   | varies    |
| X3    | data / operand   | varies    |

`SYNC` rises at the start of A1 to mark the cycle frame to external
ROM/RAM chips.

## Target demo sketch

A 4004 running the classic `Busicom 141-PF` 4-instruction blink loop
that decrements a register and writes its low bit to a CM-RAM line
driving an LED. Smallest possible "I see CPU activity" demo.

## Implementation outline

1. `4004.chip.json` — declare 16 pins above, plus a `program_rom`
   property (hex string, max 4 KB).
2. `4004.c`:
   - `chip_setup()`: register pins, allocate `cpu_state_t`, load ROM
     from property, start a repeating timer at the instruction-cycle
     period.
   - `on_cycle_tick()`: walk the 8-phase state machine, drive pins
     accordingly. For ROM reads this is internal (we hold the ROM in
     chip memory for the first cut); for RAM reads we'll route through
     external RAM chips on the canvas.
3. Test with a hand-assembled ROM that lights an LED via CM-RAM0 →
   external 4002-equivalent RAM (or, simpler, drive an LED directly
   off CM-RAM0 since it's a real output pin).

## Files to create later

- `4004.chip.json`
- `4004.c`
- `sketch.asm` (hand-assembled demo) and `rom.hex` (assembled bytes)
- `test_4004.test.ts` mirroring the style of
  `test/test_custom_chips/test/`
