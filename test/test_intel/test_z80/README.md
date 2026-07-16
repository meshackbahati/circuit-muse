# test_z80 — Zilog Z80 as a velxio custom chip

See [../autosearch/02_intel_chips_overview.md](../autosearch/02_intel_chips_overview.md#zilog-z80-1976)
for the spec.

## Status

✅ **Implemented (core).** 6/13 active tests pass; 7 are `it.todo`
deferred milestones. ~550 LOC clean-room C in `z80.c` compiled to
`fixtures/z80.wasm`.

Validated against:
- Zilog Z80 Family CPU User Manual UM008003-1202 (2002 reprint of the
  canonical doc; PDF at `autosearch/pdfs/z80_user_manual.pdf`)
- Sean Young, "The Undocumented Z80 Documented" v0.91 (PDF at
  `autosearch/pdfs/z80_undocumented.pdf`)
- Cross-checked against `floooh/chips/z80.h` (zlib),
  `superzazu/z80` (MIT, passes ZEXALL), `kosarev/z80` (MIT)

What works:
- 40-pin contract, M1 cycle (M1̅+MREQ̅+RD̅ asserted simultaneously),
  RFSH̅ pulse with R counter and I driving the address bus.
- 8080-superset ISA: LD r,r' / LD r,n / LD rr,nn / LD (nn),A / LD A,(nn) /
  ALU / INC / DEC / 16-bit ADD HL / rotates / control flow / stack.
- Z80-only: EX DE,HL / EX AF,AF' / EXX / DJNZ / JR / LDIR / LDDR / NEG
  (8 aliases) / IM 0/1/2 / EI / DI / IN / OUT.
- DD/FD prefix → IX/IY substitution for HL-using opcodes (incl. (IX+d)
  with displacement byte).
- ED prefix → block ops, IM, NEG, RETN/RETI, LD (nn),rr / LD rr,(nn).
- NMI̅ falling-edge → push PC, vector to 0x0066 (without IFF1→IFF2
  copy, per Sean Young's hardware tests, contradicting Zilog's manual).

Deferred until ZEXDOC/ZEXALL integration phase:
- X (bit 3) and Y (bit 5) "undocumented" flag bits — required by ZEXALL
  but no current test exercises them.
- MEMPTR (WZ) register — only observable through `BIT n,(HL)`.
- CB-prefix bit ops (BIT/SET/RES/RL*/RR*/SLA/SRA/SLL/SRL).
- Block I/O instruction flags (full deterministic rules per Sean Young
  §4.3 — currently approximate).
- DAA's full Z80-specific table (currently uses an 8080-equivalent
  approximation — will diverge for N=1 cases).
- Cycle-accurate WAIT̅ and contention timing.

## Pin contract (40-pin DIP)

| Group        | Pins                                                          | Dir |
| ------------ | ------------------------------------------------------------- | --- |
| Address bus  | `A0..A15`                                                     | out |
| Data bus     | `D0..D7`                                                      | I/O |
| Memory ctrl  | `MREQ̅`, `RD̅`, `WR̅`, `RFSH̅`                                    | out |
| I/O ctrl     | `IORQ̅`                                                        | out |
| Cycle marker | `M1̅`                                                          | out |
| CPU state    | `HALT̅`                                                        | out |
| Wait/sync    | `WAIT̅`                                                        | in  |
| Interrupts   | `INT̅`, `NMI̅`                                                  | in  |
| Bus arb      | `BUSREQ̅`, `BUSACK̅`                                            | I/O |
| System       | `CLK`, `RESET̅`                                                | in  |
| Power        | `VCC`, `GND`                                                  | power |

Total: 16 + 8 + 4 + 1 + 1 + 1 + 1 + 2 + 2 + 2 + 2 = **40 pins** —
all 40 of the real DIP. No power simplification needed (single 5 V rail).

## Bus cycle reference

The Z80's bus is closer to "what you'd design today" than the 8080's:

```
M1 (opcode fetch):
  T1: drive A0..A15, assert M1̅, MREQ̅ then RD̅
  T2: sample D0..D7
  T3: deassert RD̅, MREQ̅; assert RFSH̅; drive A0..A6 with R register
  T4: deassert RFSH̅
  
Memory read (non-M1):
  T1: drive A0..A15, assert MREQ̅
  T2: assert RD̅, sample D0..D7
  T3: deassert RD̅, MREQ̅
  
Memory write:
  T1: drive A0..A15, MREQ̅
  T2: drive D0..D7, assert WR̅
  T3: deassert WR̅, MREQ̅
  
I/O read/write:
  Like memory but with IORQ̅ instead of MREQ̅.
```

We faithfully drive `M1̅` and `RFSH̅` so dynamic-RAM-style wiring works
in user demos.

## Why the Z80 is the high-value target

- **Recognisable.** ZX Spectrum, MSX, GameBoy CPU (modified Z80),
  CP/M machines, MAME arcade boards. Users *will* try to wire one.
- **Best documented.** The full instruction set, including undocumented
  flags, has been reverse-engineered.
- **Best reference emulator.** `floooh/chips/z80.h` is single-header,
  cycle-accurate, MIT-licensed.

## Implementation plan

1. Spike: `LD A, n`, `OUT (n), A`, `JR n`, `HALT` only. Drive an LED
   from a memory-mapped port. Confirms the bus state machine works.
2. Port `floooh/chips/z80.h` into `z80.c` as the decoder core. Adapt
   the bus interface from "callback function" style to "drive velxio
   pins" style.
3. Run ZEXDOC / ZEXALL — the canonical Z80 documented/all-flags self
   tests. These boot CP/M-style and print results to a UART.
4. Add `INT`/`NMI` handling. Implement IM 0 / IM 1 / IM 2.
5. Stretch: hook a ZX Spectrum ROM and a 16K RAM chip; see if the
   Spectrum boot screen renders. (Display would be a separate chip.)

## Target demo sketch

Same as 8080 (UART hello world) so we can compare the two chips
side-by-side on the canvas. Then a Z80-only second demo using the
shadow registers (`EXX`) — something the 8080 cannot do — to show
the Z80's expanded ISA.

## Files to create later

- `z80.chip.json`
- `z80.c` (likely split into `z80_core.c` + `z80_decode.c` if the
  ported decoder is large)
- `vendor/` for any vendored MIT-licensed reference code (or move
  to `third-party/cpu-cores/` per the open question in
  [../autosearch/05_open_questions.md](../autosearch/05_open_questions.md#q2-where-exactly-should-vendor-emulator-cores-live))
- `roms/zexdoc.bin`, `roms/hello.bin`
- `z80.test.ts`
