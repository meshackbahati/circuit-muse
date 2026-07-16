# Open-source emulator references

Candidate emulators we could **port** or **vendor** under
`third-party/` (or under `test/test_intel/<chip>/vendor/`). All
licenses must be reviewed by a human before vendoring.

## Status convention

- **Confirmed available:** I have used or seen this code; the project
  exists.
- **[verify]:** I am ~confident the project exists from public
  references but have not just opened the repo URL during this task —
  treat as a research lead, not a citation.

---

## 8080

| Project | Lang | License | Notes |
| ------- | ---- | ------- | ----- |
| `superzazu/8080` | C | MIT | Single-file, passes CPUDIAG. Excellent porting candidate. **[verify license + URL before vendoring]** |
| MAME `i8085.cpp` | C++ | GPLv2+ | Reference for behaviour but **GPL — would force the chip code GPL** if we link it. Avoid. |

## Z80

| Project | Lang | License | Notes |
| ------- | ---- | ------- | ----- |
| `floooh/chips/z80.h` | C | MIT (zlib variant — confirm) | Single-header, table-driven, cycle-accurate. Author Andre Weissflog also publishes 8080, M6502, etc. in the same style. **Best fit.** |
| `redcode/Z80` | C++ | GPL | High-fidelity but GPL. Avoid. |
| Lin Ke-Fong's `z80emu` | C | BSD-style | Older but well-tested. Backup option. **[verify]** |

## 8086

| Project | Lang | License | Notes |
| ------- | ---- | ------- | ----- |
| `8086tiny` (Adrian Cable) | C | original ~4 KB version was permissive — confirm exact text | Famous for fitting in a few KB. Drives an entire PC clone (BIOS + DOS). May be more than we want; trim to CPU core. |
| MAME `i86.cpp` | C++ | GPL | Reference only. |

## 4004 / 4040

The 4-bit Intel chips are far less commonly emulated as standalone
cores. Realistic options:

- **MAME `mcs40.cpp`** — full and accurate, but GPL.
- **`Intel-4004` projects on GitHub** — several small educational
  emulators. None are universally trusted; we may end up writing the
  4004 from the datasheet, which is small (46 instructions) and well
  within scope.
- 4040 specifically: usually treated as a 4004 superset; expect to
  hand-write the extension instructions on top of a 4004 core.

## What goes where in this repo

If we vendor a permissively-licensed emulator, two options:

1. **`third-party/<emu-name>/`** — matches the existing pattern for
   `avr8js`, `rp2040js`, `wokwi-elements`. Top-level vendor location.
   Right call when the same emulator core is shared across multiple
   velxio chip projects.
2. **`test/test_intel/test_<chip>/vendor/`** — local to a single chip.
   Right call when the emulator is tightly coupled to one chip and we
   don't want to imply it's a project-wide dependency.

For the 8080 and Z80 ports we expect to share infrastructure (bus state
machine, helpers), so option 1 with a unified `third-party/cpu-cores/`
folder is probably the better long-term home. Decide before committing
the first port.

## Hard rule

**Do not vendor GPL emulator code into this repo.** Velxio is
Apache-2.0 (per `backend/sdk/velxio-chip.h` header). Linking a GPL
emulator into a chip would make the resulting WASM derivative work
GPL, which breaks the project's licensing posture.
