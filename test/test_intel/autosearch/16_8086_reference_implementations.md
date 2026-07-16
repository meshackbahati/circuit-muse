# 8086 Reference Implementations (permissive only)

GPL/LGPL implementations (DOSBox, MAME, QEMU, Fake86) are **excluded** per the
project's permissive-only license policy. The three references below are all
MIT or BSD/Apache.

## 1. 8086tiny — Adrian Cable

- URL: <https://github.com/adriancable/8086tiny>
- License: **MIT** (verified from header of `8086tiny.c` revision 1.25:
  *"Copyright 2013-14, Adrian Cable… This work is licensed under the MIT
  License. See included LICENSE.TXT."*).
- LOC: ~600 lines of single-file C (the README's "fully commented source under
  25 KB" claim).
- Test ROM coverage: ships with custom XT-compatible BIOS (`bios_source/bios.asm`)
  and a FreeDOS-class disk image; documented to run **DOS 3.3, MS-DOS, Windows
  3.0, AutoCAD, MS Flight Simulator, GW-BASIC, Alley Cat**. No formal
  per-instruction test suite — correctness validated empirically by
  software-runs-or-doesn't.

## 2. MartyPC — Daniel Balsom

- URL: <https://github.com/dbalsom/martypc>
- License: **MIT** (verified, `LICENSE` reads
  *"Copyright 2022-2025 Daniel Balsom — Permission is hereby granted, free of
  charge…"* — standard MIT).
- LOC: not declared on the project page; the repo is multi-crate Rust, on the
  order of tens of thousands of lines (estimate, not verified — flag as
  uncertain).
- Test ROM coverage: the **MartyPC CPU achieves 99.9997 % cycle accuracy**
  against the SingleStepTests 8088 V2 suite (<https://github.com/SingleStepTests/8088>:
  10 000 tests per opcode, hardware-recorded on a real AMD D8088, MIT-licensed,
  also covers prefetch-queue state). Validated by physical cycle-by-cycle
  comparison against a real 8088 driven by an Arduino Mega
  (<https://github.com/dbalsom/arduino_8088>). All NEC V20 native instructions
  also tested vs. hardware. Runs the historically demanding 8088MPH and
  Area 5150 demos.

## 3. YJDoc2/8086-Emulator — Yashodhan Joshi

- URL: <https://github.com/YJDoc2/8086-Emulator>
- License: **Dual Apache-2.0 / MIT** (the Rust-ecosystem default).
- LOC: small (a few thousand LOC of Rust); a Rust/web interpreter rather than
  a system emulator.
- Test ROM coverage: **none**. README explicitly disclaims "does not allow
  jumps to memory positions, does not support ISRs, no external devices."
  Useful for instruction-decoder cross-checking only — not a fidelity reference.

## Cross-checked edge cases

The three implementations agree on the easy stuff. Disagreements worth
recording for Velxio:

- **AF on ADD/SUB**: All three set AF = 1 iff carry out of bit 3 (add) or
  borrow into bit 3 (sub). Matches manual p.2-35 (PDF p.57).
- **DAA pseudocode**: 8086tiny and MartyPC both implement the manual's
  algorithm verbatim (PDF p.58, see `15_8086_authoritative_spec.md` §9). OF
  is **left unchanged** by 8086tiny (pragmatic choice) but written
  unconditionally to a defined value by MartyPC matching the SingleStepTests
  reference recordings (so OF is "undefined per Intel" but actually
  deterministic in silicon — the test suite captures the silicon state).
- **MUL/DIV flag undefinedness**: Manual p.2-51 (PDF p.73) marks SF/ZF/AF/PF
  undefined and OF/CF defined for MUL (= 1 if upper-half nonzero). MartyPC
  matches the silicon's actual values (which are NOT random — SF mirrors
  bit 15/31 of the result, ZF reflects the full result on real hardware
  according to SingleStepTests recordings). 8086tiny treats them as
  truly-don't-care and leaves them at the previous values. This is a
  visible behavioral split — Velxio should follow MartyPC/SingleStepTests
  for accuracy.
- **DIV by zero / DIV overflow**: All three correctly raise INT 0; the
  saved-IP value points at the **next** instruction (post-DIV), per manual
  p.2-25 (PDF p.47). Some early documentation suggested IP points at the
  DIV itself; this is a documented errata corrected in the 1981 manual.
- **REP + string-op exact sequence**: All three follow the algorithm in
  `15_8086_authoritative_spec.md` §10. SingleStepTests covers REP with
  CX = 0 (immediate fall-through), CX = 1, and mid-iteration interrupt
  with both LOCK and segment-override prefixes — the latter is where
  8086tiny is known to drop the segment-override on resume (matching the
  manual's documented quirk on PDF p.64).
- **Undocumented opcodes**: 0x0F (POP CS — works on 8086 only, hangs the
  8088), 0x60-0x6F aliases, 0xC0-0xC1 aliases of 0xC2-0xC3, 0xD6 (SALC),
  0xF1 (alias of INT 1). MartyPC handles all per silicon; 8086tiny handles
  the common ones (POP CS, SALC). YJDoc2 handles none.
