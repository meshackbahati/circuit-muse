# test_8080 — Intel 8080 as a velxio custom chip

See [../autosearch/02_intel_chips_overview.md](../autosearch/02_intel_chips_overview.md#intel-8080-1974)
for the spec.

## Status

✅ **Implemented.** 18/20 tests passing. ~470 LOC clean-room C in
`8080.c` compiled to `fixtures/8080.wasm`.

Validated against:
- Intel 8080 Microcomputer Systems User's Manual (Sept 1975, doc 98-153B)
- Intel 8080/8085 Assembly Language Programming Manual (May 1981, doc 9800301D)
- Cross-checked AC flag rules, DAA, status bytes, and CALL/RST stack
  ordering against `superzazu/8080` (MIT, passes 8080EXM) and
  `mayawarrier/intel8080-emulator` (MIT). No code was copied — only
  authoritative spec consultation.

The 2 remaining `it.todo` tests are integration milestones (hand-built
loop, CPUDIAG ROM run) deferred until a generic `rom-32k` chip exists.

## Pin contract (40-pin DIP)

Power simplified: real 8080 needed +12 V / +5 V / −5 V; we collapse to
single `VCC` / `GND`. Documented under
[../autosearch/05_open_questions.md](../autosearch/05_open_questions.md#q6-power-pins--collapse-or-model).

| Group        | Pins                                | Dir |
| ------------ | ----------------------------------- | --- |
| Address bus  | `A0..A15`                           | out |
| Data bus     | `D0..D7`                            | I/O |
| Status/ctl   | `SYNC`, `DBIN`, `WR̅`, `INTE`        | out |
| Inputs       | `RESET`, `READY`, `HOLD`, `INT`     | in  |
| Outputs      | `WAIT`, `HLDA`                      | out |
| Clock        | `φ1`, `φ2`                          | in  |
| Power        | `VCC`, `GND`                        | power |

Total registered pins: 16 (addr) + 8 (data) + 4 (status) + 4 (inputs) +
2 (outputs) + 2 (clock) + 2 (power) = **38**. Two real-silicon pins
(`+12`, `−5`) are dropped.

## Bus cycle reference

For each machine cycle:

```
T1: drive A0..A15 with target address.
    Drive D0..D7 with status byte (memory read = 0x82, etc.).
    Pulse SYNC high.
T2: deassert SYNC. Switch D0..D7 to input (for reads) or hold them
    as data output (for writes). Assert DBIN (read) or WR̅ (write).
T3: sample D0..D7 (read) or hold (write).
TW: optional, while READY is low.
T4..T5: instruction-internal work, no bus activity.
```

In the timer-driven model we collapse all five T-states into a single
"step one instruction" callback that internally walks T1→T3 and emits
the pin events in order. A faithful single-step mode driven by an
external clock chip is a follow-up.

## Target demo sketch

CP/M-style "hello world" via memory-mapped UART: 8080 wired to a
ROM chip (program), a RAM chip (stack/heap), and a UART chip
(velxio's `uart-rot13.c` example shows that custom UARTs work).
Program prints to UART; user sees output in the velxio serial monitor.

This is a real, recognisable retro-computing demo.

## Implementation plan

1. Spike a minimal 8080 chip that runs MOV / ADD / JMP only,
   driving an LED off `D0` of a memory-mapped output port. Confirms
   the bus state machine works.
2. Port the full ISA from a permissively-licensed reference (see
   `autosearch/04`) into `8080.c`.
3. Run CPUDIAG (the standard 8080 self-test program) — load it as
   ROM, verify it prints "CPU IS OPERATIONAL" via the UART.
4. Add interrupt support (8259-style PIC is out of scope; just `INT`
   pin → fixed RST vector for the first cut).

## Files to create later

- `8080.chip.json`
- `8080.c` (or split into `8080.c` + `8080_decode.h` if it gets large)
- `roms/cpudiag.bin` (public-domain test ROM)
- `8080.test.ts`
