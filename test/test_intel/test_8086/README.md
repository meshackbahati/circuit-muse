# test_8086 — Intel 8086 as a velxio custom chip

See [../autosearch/02_intel_chips_overview.md](../autosearch/02_intel_chips_overview.md#intel-8086-1978)
for the spec.

## Status

✅ **Implemented (minimum-mode baseline).** 3/13 active tests pass;
10 are `it.todo` deferred. ~750 LOC clean-room in `8086.c` compiled
to `fixtures/8086.wasm`.

Validated against:
- Intel 8086 Family User's Manual, October 1979 (PDF at
  `autosearch/pdfs/iapx_86_88_users_manual.pdf`)
- Cross-checked against 8086tiny (MIT, Adrian Cable),
  MartyPC (MIT, dbalsom — hardware-validated 99.9997% on
  SingleStepTests 8088 V2), YJDoc2/8086-Emulator (Apache+MIT)

What works:
- 40-pin minimum-mode contract (AD0..AD15, A16..A19, ALE, RD, WR,
  M/IO, DT/R̅, DEN̅, BHE̅, INTR, NMI, INTA̅, RESET, READY, TEST̅, CLK,
  HOLD, HLDA, MN/MX̅, VCC, GND).
- Reset state per [I86] PDF p.51: CS=0xFFFF, IP=0, all other segs=0,
  flags clear with reserved bits canonicalised. First fetch at
  physical address 0xFFFF0 with proper ALE strobe.
- Bus cycle T1-T4 (instruction-per-tick collapse): drive AD with low
  16 addr, A with high 4, pulse ALE, switch AD to input, assert RD̅
  (or drive data + WR̅ for writes).
- 20-bit physical addressing: (segment<<4)+offset modulo 1 MB.
- Register file: AX/BX/CX/DX with byte halves (union), SP/BP/SI/DI,
  IP, CS/DS/ES/SS, FLAGS.
- ModR/M decode for memory operands (Table 4-10 effective-address
  formulas with default-segment selection).
- ~50 opcodes: NOP, HLT, MOV reg/imm and r/m forms, MOV sreg, MOV
  AL/AX,[addr]; ADD/OR/ADC/SBB/AND/SUB/XOR/CMP r/m + r and reverse
  + AL/AX-imm forms; Group 1 (immediate ALU); INC/DEC r16; PUSH/POP
  r16; PUSHF/POPF; CLC/STC/CLI/STI/CLD/STD/CMC; conditional short
  jumps Jcc; JMP near/short/far; CALL near/far; RET near/far +imm;
  LOOP/LOOPE/LOOPNE/JCXZ; Group 5 (INC/DEC/CALL/JMP/PUSH r/m16);
  segment-override prefixes.

Deferred (10 it.todo tests):
- String ops (MOVS/CMPS/SCAS/LODS/STOS) with REP/REPE/REPNE prefix.
- MUL/DIV/IMUL/IDIV with their per-flag undefined-ness.
- BCD adjust (DAA/DAS/AAA/AAS/AAM/AAD).
- Port I/O instructions (IN/OUT).
- Hardware interrupts (NMI vector 2; INTR + INTA cycle reading the
  vector byte from the data bus).
- Maximum-mode bus protocol with QS0/QS1, S0..S2 status pins.
- Cycle-accurate prefetch queue.
- Undocumented opcodes (POP CS at 0x0F, SALC at 0xD6 — original
  8086 only).

Test infrastructure for the multiplexed AD bus + ALE-driven 8282
demux is also pending — the ISA tests need a fake-8086-ROM helper
that snapshots AD on ALE rising and drives back during RD̅ asserted.

## Pin contract (40-pin DIP, minimum mode)

Minimum mode (MN/MX̅ tied high) keeps things sane. Maximum mode is a
follow-up.

| Group           | Pins                                                 | Dir       |
| --------------- | ---------------------------------------------------- | --------- |
| Multiplexed bus | `AD0..AD15` (low addr / data, multiplexed)           | I/O       |
| Multiplexed bus | `A16/S3 .. A19/S6` (high addr / status, multiplexed) | out       |
| Bus control     | `ALE`, `RD̅`, `WR̅`, `M/IO`, `DT/R`, `DEN̅`             | out       |
| Bus arb         | `HOLD`, `HLDA`                                       | I/O       |
| Interrupts      | `INTR` (in), `NMI` (in), `INTA̅` (out)                | mixed     |
| System          | `RESET`, `READY`, `TEST̅`, `CLK`                      | in        |
| Mode select     | `MN/MX̅` (tie high for min mode)                      | in (fixed)|
| Power           | `VCC`, `GND` (×2 on real silicon)                    | power     |
| Status (min)    | `BHE̅/S7`                                            | out       |

Real silicon has ~40 pins; we register all of them.

## Bus cycle reference (minimum mode read)

```
T1: drive A0..A19 onto AD0..AD15 + A16..A19 pins (low addr on AD).
    Drive ALE high then low to latch the address into an external 8282.
T2: switch AD0..AD15 to input (read) or hold as data out (write).
    Assert RD̅ (read) or WR̅ (write).
    Assert M/IO appropriately (1 = memory, 0 = I/O).
T3: sample AD0..AD15 (read) or hold the data (write).
TW: while READY is low, stay in T3.
T4: deassert RD̅/WR̅. Bus is free.
```

The chip itself does **not** demultiplex the address. An external
"address latch" chip on the canvas (8282 equivalent) does that. See
[../autosearch/05_open_questions.md](../autosearch/05_open_questions.md#q3-is-there-a-built-in-address-latch-primitive).

## What's hard about the 8086

| Concern                      | Strategy |
| ---------------------------- | -------- |
| AD bus multiplexing          | Per-cycle direction switching (`vx_pin_set_dir`) — proven feasible by analogy with `mcp3008.c`'s state machine. |
| 20-bit physical addr         | Internal: `(seg << 4) + off`. Trivial. |
| Variable-length instructions | ModR/M decode + displacement / immediate fetch. Big switch on opcode + helper tables. |
| Prefetch queue (4–6 byte)    | **Skip for the first cut.** Decode at IP. Full prefetch can come later. |
| Segment register hazards     | Honour the standard 8086 ordering: segment override prefixes, default segments per addressing mode. Reference any 8086 emulator. |
| Min vs Max mode              | Min only. Document that user must tie `MN/MX̅` high. |

## Target demo sketch

A 16-bit "hello world" assembly program that prints a string to a
memory-mapped UART. Recognisable, modest scope, doesn't need DOS or
BIOS emulation.

Stretch: run a tiny subset of `8086tiny`'s BIOS to boot a ROM-based
program. Real DOS booting is firmly out of scope until much later.

## Implementation plan

1. Spike: `MOV reg, imm` + `OUT` + `HLT` only. Wire to a ROM chip and
   a UART chip. Confirms the AD bus multiplexing.
2. Add register file (8 × 16-bit gp + 4 × 16-bit segment + flags + IP).
3. Add ModR/M decode and effective-address calculation.
4. Add the rest of the ISA in waves: data movement, arithmetic,
   logical, control flow, string ops, interrupts.
5. Run a known-good 8086 test suite (`8088_v1` test ROMs, etc.) —
   tracked in [../autosearch/05_open_questions.md](../autosearch/05_open_questions.md).

## Files to create later

- `8086.chip.json`
- `8086.c`, `8086_decode.c`, `8086_modrm.c` (will likely split)
- `address_latch.chip.json` + `address_latch.c` (the 8282 helper)
- `roms/hello.bin`
