# test_4040 — Intel 4040 as a velxio custom chip

See [../autosearch/02_intel_chips_overview.md](../autosearch/02_intel_chips_overview.md#intel-4040-1974)
for the spec.

## Status

✅ **Implemented (bus skeleton + STOP/STPA).** 2/5 active tests pass;
3 are `it.todo` deferred. ~250 LOC clean-room in `4040.c` compiled to
`fixtures/4040.wasm`.

Validated against Intel MCS-40 User's Manual (Nov 1974) — PDF at
`autosearch/pdfs/mcs40_users_manual.pdf`. Cross-checked control logic
against `markablov/i40xx` (MIT) and `Kostu96/K4004` (MIT, ships
Busicom 141-PF firmware).

What works:
- Full 24-pin DIP contract per [M40] pp. 1-5/1-6 — STP, STPA, INT,
  INTA, CY, dual CMROM (CMROM0/CMROM1), dual standby Vdd1/Vdd2.
- 8-phase frame inherited from 4004 (binary-compatible, [M40] p. 1-22).
- STP latched at M2 → STOP FF set at X3 → STPA asserts within ~2
  instruction cycles ([M40] p. 1-10). Clock and SYNC continue per
  manual ("CPU executes NOPs in a loop").
- INT latched at M2 with EIN active → forced JMS to PC=0x003 at X3,
  INTA asserts ([M40] p. 1-12). Vector address is fixed; no vector
  table.
- Index register file extended to 24 × 4 bits (3 banks × 8); SB0/SB1
  bank-select FF in place though not exercised by tests.
- 7-deep PC stack ([M40] p. 1-12) — replaces 4004's 3-deep stack.

Deferred:
- 14 new instructions' semantics: HLT, BBS, LCR, OR4/OR5, AN6/AN7,
  DB0/DB1, SB0/SB1, EIN/DIN, RPM (currently all decoded as NOP).
- BBS return-from-interrupt behaviour (pop stack, restore SRC, restore
  bank FF, clear INTA).
- DB0/DB1 ROM-bank-select with 3-cycle takeover delay.
- HALT FF semantics (HLT opcode).
- Interrupt-during-2-byte-instruction edge cases ([M40] open question).

## Pin contract (24-pin DIP, real silicon)

The 4040 is a 4004 superset; it keeps every 4004 signal and adds:

- `INT` (interrupt request, in)
- `STOP` (single-step, in)
- `STOP ACK` (out)
- Additional bank-select / index-pointer lines

**Action item:** pull the exact 4040 pinout from a datasheet and fill
in this table before writing `.chip.json`. Pin order matters for the
on-canvas drag-and-drop appearance.

| Pin | Name      | Dir   | Notes |
| --- | --------- | ----- | ----- |
|     | D0..D3    | I/O   | Same multiplexed nibble bus as 4004 |
|     | CLK1, CLK2| in    | |
|     | SYNC      | out   | |
|     | RESET     | in    | |
|     | TEST      | in    | |
|     | CM-ROM0..1| out   | 4040 has *two* ROM strobes (4004 has one) |
|     | CM-RAM0..3| out   | |
|     | INT       | in    | New on 4040 |
|     | STOP      | in    | New on 4040 |
|     | STOP ACK  | out   | New on 4040 |
|     | VDD, VSS  | power | |

## Implementation plan

1. Land the 4004 first.
2. Fork its `.c` source into `4040.c`.
3. Extend the register file from 16 → 24 4-bit registers.
4. Extend the PC stack from 3-deep → 7-deep.
5. Add the new opcodes (interrupt enable/disable, return-from-interrupt,
   stop, the extra register-pair operations).
6. Add `INT` pin watch. On rising edge, push PC and vector to fixed
   address `[verify from datasheet]`.
7. Add `STOP` pin watch. On rising edge, freeze the cycle timer and
   assert `STOP ACK`.

## Target demo sketch

Same as 4004 (LED blink), then a second sketch that uses `INT` —
an external "button" chip drives `INT`, the 4040's ISR toggles a
different output. Demonstrates the only feature that matters versus
the 4004.

## Files to create later

- `4040.chip.json`
- `4040.c`
- `sketch_blink.asm`
- `sketch_irq.asm`
