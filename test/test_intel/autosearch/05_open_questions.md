# Open questions

Things to resolve before committing emulator code.

## Q1. Do we need a generic external memory chip first? — **RESOLVED**

**Decision:** yes, build `rom-32k.c` and `ram-64k.c` as separate
reusable chips. They live in `test/test_intel/test_buses/`. Tests
exist (`rom-32k.test.js`, `ram-64k.test.js`); chip code is the next
phase.

For CPU **unit** tests we use `BoardHarness.installFakeRom()` and
`installFakeRam()` (pure-JS) — no per-test recompile. The real C chips
are needed for **integration** tests and for end-user demos on the
canvas (where the user drags ROM/RAM next to a CPU).

## Q2. Where exactly should vendor emulator cores live? — **RESOLVED (moot)**

**Decision:** we don't vendor any third-party emulator cores. All five
CPUs are clean-room implementations from public datasheets. The risk
of GPL contamination outweighs the convenience of porting an existing
emulator, and we get a higher quality bar by writing it ourselves.

Reference emulators listed in
[04_open_source_emulator_references.md](04_open_source_emulator_references.md)
remain useful as **behavioural references** (look up "what should
DAA produce after 0x99 + 0x01?") but no code is copied.

## Q3. Is there a built-in "address latch" primitive?

The 8086 needs an external `8282`-style address latch to demultiplex
`AD0..AD15` into stable `A0..A15`. We can:

- Author it as another custom chip (most consistent — but extra work).
- Inline the demux into the CPU itself by exposing already-demultiplexed
  pins (un-realistic but pedagogically simpler for a first cut).

**Status:** I have not searched for an existing latch chip in
`test/test_custom_chips/sdk/examples/`. The current list (per
`autosearch/01`'s file inventory) does not include one. Confirm
before writing.

## Q4. How are chip-config blobs (ROM images) wired? — **RESOLVED (with caveat)**

**Finding:** the SDK has no blob-property mechanism. `vx_attr_register`
takes only a `double`. The existing EEPROM examples
(`eeprom-24c01.c`, `eeprom-24lc256.c`) hardcode their initial state in
C as `static uint8_t mem[SIZE]` (zero-initialised at chip_setup); they
do NOT load anything from `.chip.json`.

**Decision for now:** each ROM variant is a separately compiled chip
(`rom-32k-cpudiag.wasm`, `rom-32k-helloworld.wasm`, etc.) with its
image baked into a `const uint8_t rom_image[]` in C.

**Future enhancement (deferred — explicitly not done before chip code
lands):** propose adding `vx_attr_register_blob(name, default_bytes,
default_len)` to the SDK, returning a `(ptr, len)` pair the chip can
read at startup. This would let one `rom-32k.wasm` serve any image
loaded from the diagram editor. Open as a follow-up SDK PR after
the first CPU is shipped.

## Q5. What is the realistic upper bound on timer fire rate?

The runtime ticks chips during the simulation frame. If we run a Z80
at 4 MHz with a per-T-state timer (250 ns period) we'd be asking for
4 million callbacks per simulated second, which the host loop very
likely can't sustain in real time. Two implications:

- We may have to coalesce multiple T-states per callback (do the
  whole instruction in one tick), losing some single-step fidelity
  but staying tractable.
- Pure simulated-time timing (`vx_sim_now_nanos`) may decouple
  enough — the chip *thinks* it's running at 4 MHz even when wall-clock
  throughput is lower. Confirm by reading the timer dispatcher in
  `frontend/src/simulation/customChips/`.

**Status:** unverified. Run a tight-timer benchmark before committing
to a target clock rate.

## Q6. Power pins — collapse or model?

Real 8080 needs +12 V, +5 V, −5 V. Velxio is digital. Plan: expose a
single `VCC` and `GND` pin on every CPU. Document the simplification
in each chip's README.

**Status:** decided (collapse). Recorded here for transparency.

## Q7. Are open-drain / bus-tristate semantics modelled?

Real CPUs tristate the data bus during writes-from-other-masters. The
velxio pin model is digital HIGH/LOW; "tristated / Z" is generally not
a first-class state. We will model bus-release by setting the pins to
input (`vx_pin_set_dir(pin, VX_INPUT)`) and rely on no other chip
asserting them simultaneously.

**Status:** convention adopted. Verify there are no contention
warnings in the runtime that would fire during a normal CPU bus cycle.
