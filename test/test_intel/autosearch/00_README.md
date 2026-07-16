# autosearch — Research notes for Intel + Z80 custom-chip emulation

This is the scratchpad for everything we *learn* while building these
chips. It mirrors the convention used in `test/autosearch/` (numbered
markdown files, oldest first).

## Index

- [01_velxio_chip_capabilities.md](01_velxio_chip_capabilities.md) —
  What the velxio custom-chip SDK and runtime actually offer today
  (pins, memory, timers, I²C/SPI/UART). Sourced by reading
  `backend/sdk/velxio-chip.h` and
  `frontend/src/simulation/customChips/ChipRuntime.ts`.
- [02_intel_chips_overview.md](02_intel_chips_overview.md) —
  Per-chip facts: package, pin count, bus widths, clock, instruction
  set scale, register file size. Public-domain hardware facts (ISA
  references, Intel datasheets are widely mirrored).
- [03_emulation_strategy.md](03_emulation_strategy.md) —
  How an instruction-level emulator maps onto the velxio reactive
  callback model. Timer-driven `step()`, pin multiplexing, bus mastering.
- [04_open_source_emulator_references.md](04_open_source_emulator_references.md) —
  Candidate header-only or tiny C emulators we could port (subject to
  license review before vendoring).
- [05_open_questions.md](05_open_questions.md) —
  Things we don't know yet and need to confirm before writing code.

## Conventions

- Cite the source for any specific number (datasheet section, repo path,
  or "common knowledge — verify").
- If a fact is uncertain, write it under "Open questions" instead of
  the spec docs.
- License-sensitive code (an emulator we vendor) goes in the per-chip
  folder, **not** here. This folder is research only.
