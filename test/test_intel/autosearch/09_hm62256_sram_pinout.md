# 64 KB SRAM — pinout reference for `ram-64k.c`

The closest real-world part to the 64 KB byte-wide SRAM we want is
the **HM628512 / HM6264** family from Hitachi (later Renesas), or the
**Cypress CY62256** (which is 32 KB) scaled up. For the velxio model
we use an idealised 64 KB part: 16 address pins, 8 data pins, three
control signals.

## Package: 32-pin DIP-equivalent (logical model)

| Group | Pins | Direction | Notes |
|-------|------|-----------|-------|
| Power | VCC, GND | power | +5 V |
| Address | A0..A15 (16) | input | Selects byte at offset `addr` |
| Data | D0..D7 (8) | bidirectional | Output during read, input during write |
| Chip enable | CE̅ | input | Active-low |
| Output enable | OE̅ | input | Active-low |
| Write enable | WE̅ | input | Active-low |

## Read / write logic

| CE̅ | WE̅ | OE̅ | Mode                 | Action |
|-----|-----|-----|----------------------|--------|
| H   | x   | x   | **Not selected**     | D pins high-Z; mem unchanged |
| L   | H   | L   | **Read**             | Drive `mem[addr]` onto D pins |
| L   | H   | H   | **Output disable**   | D pins high-Z; mem unchanged |
| L   | L   | x   | **Write**            | Latch `mem[addr] := data` on WE̅ rising edge |

The "rising-edge latches" convention matches every common SRAM
datasheet and is what `ram-64k.test.js`'s `writeCycle()` helper
asserts: drop WE̅ low, hold for a setup time, raise WE̅ → cell is
written. Real SRAMs latch at end-of-WE per the part's `t_DH` (data
hold) timing; we model that as instantaneous on the rising edge.

## Power-on state

Real SRAM is volatile and powers up with **indeterminate** contents.
The `ram-64k.test.js` blank-state assertion (`reads 0x00 from
never-written addresses`) relies on our model zero-initialising mem at
chip_setup. This is a deliberate simplification — easier to test
against, and matches what most simulators do (Wokwi, ASIC Verilog
sims, etc.).

## Why no PCB-realistic 28-pin layout

The HM62256 (32 KB, 28-pin) was the real-world workhorse and a
faithful "32-pin equivalent of 62256" doesn't exist as a single chip
historically. For 64 KB on a single chip, the practical options are
the HM628128 (16 KB? no — 128 Kbit = 16 KB) family up through
HM628512 (512 Kbit = 64 KB, 32-pin DIP). We adopt the HM628512 pin
philosophy without modelling its precise pin ordering, since velxio
doesn't enforce DIP-package physical layout.
