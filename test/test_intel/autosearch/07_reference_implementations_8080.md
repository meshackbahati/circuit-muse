# 8080 Reference Implementations — Cross-Validation

Three permissively-licensed C 8080 cores were verified live on GitHub for use as second-opinion references. **No code is being copied — these are consulted only to cross-check flag tables and edge cases.**

## 1. `superzazu/8080`

- URL: https://github.com/superzazu/8080
- License: **MIT** (Copyright 2018 Nicolas Allemand) — verified
- Structure: multi-file but tiny — `i8080.c` (782 LOC), `i8080.h` (small), `i8080_tests.c`. C99.
- Trust signals: 179 stars, last pushed 2022-07; powers `superzazu/invaders` (Space Invaders).
- **Validated against**: TST8080.COM, CPUTEST.COM, 8080PRE.COM, **8080EXM.COM** — all PASS with cycle-exact totals (e.g. CPUTEST: 255,653,383 cycles, diff=0). Including the full 8080 instruction exerciser is a strong correctness signal.

## 2. `floooh/chips` — IMPORTANT DISCREPANCY WITH USER QUERY

- URL: https://github.com/floooh/chips
- License: **Zlib** (Copyright 2018 Andre Weissflog) — verified. Same author as the famous `z80.h`. Confirmed.
- **`i8080.h` does NOT exist in this repo.** Listing `/chips/` shows `z80.h` (138 KB) but no `i8080.h` (verified via the GitHub contents API and a recursive tree search). The user's premise is incorrect — Andre Weissflog has not published a standalone i8080 header. Skipping this as a reference; substituting a third MIT source below.

## 3. `mayawarrier/intel8080-emulator` (substituted third reference)

- URL: https://github.com/mayawarrier/intel8080-emulator
- License: **MIT** — verified
- Structure: `src/i8080.c` (882 LOC), C89/ANSI C, optionally freestanding.
- Validated against TST8080.COM, CPUTEST.COM, 8080PRE.COM, plus an INTERRUPT.COM async-interrupt test. README cites the Tandy 8085 manual (pg 24, 63, 122) for individual flag behaviors — useful when comparing against the datasheet.

(Other candidates rejected: `begoon/i8080-core` is GPLv2; `ibara/i80` is ISC but README admits "Incomplete AC flag handling (don't use DAA)" — unsafe as a reference.)

---

## Edge-case cross-reference

### A. ANA (AND) — AC flag

**Both references AGREE**: AC = ((A | operand) >> 3) & 1 (the OR of bit 3 of A and operand).

superzazu (`i8080.c:214`):
```c
c->hf = ((c->a | val) & 0x08) != 0;
```
mayawarrier (`i8080.c:199`, comment cites "Tandy manual, pg 24"):
```c
cpu->ac = get_bit(cpu->a, 3) | get_bit(word, 3);
```
This is the documented 8080 behavior (different from Z80, where ANA always sets H=1). Both pass 8080EXM's `aluop` CRC, so this is the correct rule.

### B. SUB / SBB — AC flag

**Both AGREE: AC = 1 when there is *no* borrow from bit 4** (i.e. AC flag is the inverted borrow, mirroring how 8080 carry works for SUB).

Both implement SUB as `A + ~val + !cy`, then use the same `aux_carry`/`carry(4,...)` helper used by ADD on the inverted operand. So:
- `AC = carry-out of bit 3 of (A + (~val & 0x0F) + !cy)`
- Equivalently: AC=1 means the low nibble did *not* require a borrow.

superzazu (`i8080.c:181`):
```c
static inline void i8080_sub(...) {
  i8080_add(c, reg, ~val, !cy);
  c->cf = !c->cf;
}
```
mayawarrier (`i8080.c:190`):
```c
cpu->ac = aux_carry(cpu->a, word ^ 0x0f, !cy);
```
Note: this matches the 8080 datasheet ("AC is set if there is a carry out of bit 3"); **it is the OPPOSITE of the user's "1 when borrow" formulation**. Implementations that pass CPUTEST use "AC=1 when no borrow from bit 4".

### C. DAA pseudocode (from superzazu — passes 8080EXM)

```c
bool cy = c->cf;  uint8_t correction = 0;
uint8_t lsb = a & 0x0F;  uint8_t msb = a >> 4;
if (hf || lsb > 9)                              correction += 0x06;
if (cf || msb > 9 || (msb >= 9 && lsb > 9)) {   correction += 0x60; cy = 1; }
i8080_add(&a, correction, 0);   // updates Z, S, P, AC normally
c->cf = cy;                     // restore/promote carry afterwards
```
Key subtleties confirmed against 8080EXM `<daa,cma,stc,cmc>` CRC (`bb3f030c`):
1. The CY flag is **never cleared** by DAA — it only sets to 1, never to 0.
2. AC after DAA reflects the carry from the `+0x06` step (handled implicitly by reusing `add`).
3. Use `msb >= 9 && lsb > 9` (not `>9 && >9`) for the 0x60 trigger.

mayawarrier diverges slightly: `(hi == 9 && lo > 9)` instead of `>= 9`. **Flag for verification** — superzazu's `>= 9` form is the one that passes 8080EXM. mayawarrier may rely on a different code path catching the same case via `cy`.

### D. Status byte values (from Intel 8080 datasheet, deramp.com PDF cited by mayawarrier)

The 8080 outputs the status byte on D0-D7 during SYNC. Bits (D7..D0):

| Cycle    | Hex  | INTA D0 | WO  D1 | STACK D2 | HLTA D3 | OUT D4 | M1 D5 | INP D6 | MEMR D7 |
|----------|------|---------|--------|----------|---------|--------|-------|--------|---------|
| M1 fetch | 0xA2 | 0       | 1      | 0        | 0       | 0      | 1     | 0      | 1       |
| MEM READ | 0x82 | 0       | 1      | 0        | 0       | 0      | 0     | 0      | 1       |
| MEM WRITE| 0x00 | 0       | 0      | 0        | 0       | 0      | 0     | 0      | 0       |
| STACK RD | 0x86 | 0       | 1      | 1        | 0       | 0      | 0     | 0      | 1       |
| STACK WR | 0x04 | 0       | 0      | 1        | 0       | 0      | 0     | 0      | 0       |
| INPUT RD | 0x42 | 0       | 1      | 0        | 0       | 0      | 0     | 1      | 0       |
| OUTPUT WR| 0x10 | 0       | 0      | 0        | 0       | 1      | 0     | 0      | 0       |
| INTA     | 0x23 | 1       | 1      | 0        | 0       | 0      | 1     | 0      | 0       |
| HALT ACK | 0x8A | 0       | 1      | 0        | 1       | 0      | 0     | 0      | 1       |

(WO is active-low: WO=1 means READ, WO=0 means WRITE. Verify against pg 2-2 of the Intel User's Manual.) Neither superzazu nor mayawarrier emulates the SYNC status pin (they're functional emulators, not bus-cycle emulators) — this table comes from the datasheet only. **Validate this table against the original Intel manual yourself** before trusting it.

### E. RST pushed-PC

**Both agree**: PC pushed by RST is the address **of the next instruction** (PC is already incremented past the RST opcode by the fetch). superzazu `i8080_call` simply calls `push_stack(c->pc)` *after* the opcode fetch advanced PC. RST n is implemented as `i8080_call(c, n*8)`. Same in mayawarrier.

### F. CALL / push order

**Both agree**: SP is decremented by 2, **high byte is written to (SP+1), low byte to SP**. Equivalently: high byte ends up at the higher address. In conventional "push order" terms, **high byte is pushed first**, then low byte.

superzazu `i8080_ww` (the writer used by `push_stack`):
```c
c->write_byte(c->userdata, addr,     val & 0xFF);   // low at SP
c->write_byte(c->userdata, addr + 1, val >> 8);     // high at SP+1
```
mayawarrier `i8080_push` is explicit (decrement-then-write twice, high first):
```c
sp--; mem_write(sp, hi);
sp--; mem_write(sp, lo);
```
Same net effect; high byte at higher address. POP reverses.

---

## Discrepancies to watch in YOUR implementation

1. **DAA tens trigger**: superzazu uses `msb >= 9 && lsb > 9`; mayawarrier uses `hi == 9 && lo > 9`. Use superzazu's form (8080EXM-validated).
2. **AC on SUB**: must be set on **no borrow** (carry-out of bit 3 from `A + ~val + !cy`), NOT on borrow. Easy off-by-one.
3. **ANA AC**: must be `(A | operand) bit 3`, not `0` and not `1`. This is the most commonly wrong flag in 8080 emulators.
4. **PSW bit 1** is **always 1**, bits 3 and 5 are **always 0** when pushed (both refs agree).
5. **floooh/chips has no i8080.h** — do not look there for an 8080 reference; only z80.h exists.

## Files referenced
- `/tmp/superzazu_i8080.c` (in-memory only — not vendored)
- Verified URLs:
  - https://raw.githubusercontent.com/superzazu/8080/master/i8080.c
  - https://raw.githubusercontent.com/mayawarrier/intel8080-emulator/master/src/i8080.c
  - https://raw.githubusercontent.com/superzazu/8080/master/LICENSE
  - https://raw.githubusercontent.com/floooh/chips/master/LICENSE
