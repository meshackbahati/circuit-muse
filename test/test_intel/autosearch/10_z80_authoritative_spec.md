# Zilog Z80 Authoritative Specification

Sources (in `autosearch/pdfs/`):

- **[U]** *Z80 Family CPU User Manual*, Zilog **UM008003-1202** (Dec 2002; content matches the 2016 UM008011-0816 reprint). Page numbers below are the printed body-page footers.
- **[Y]** Sean Young, *The Undocumented Z80 Documented*, v0.91 (2005). GFDL. Used for X/Y flags, MEMPTR, block-I/O flags, DAA tables.

---

## 1. Pin Contract — 40-pin DIP ([U] Fig. 3 p. 7; [Y] §2.5 p. 9)

| Pin(s) | Name | Dir | Active |
|---|---|---|---|
| 30–40, 1–5 | A0..A15 | Out, tri-state | High |
| 14, 15, 12, 8, 7, 9, 10, 13 | D0..D7 | I/O, tri-state | High |
| 27 | M1̅ | Out | Low |
| 19 | MREQ̅ | Out, tri-state | Low |
| 20 | IORQ̅ | Out, tri-state | Low |
| 21 | RD̅ | Out, tri-state | Low |
| 22 | WR̅ | Out, tri-state | Low |
| 28 | RFSH̅ | Out | Low |
| 18 | HALT̅ | Out | Low |
| 24 | WAIT̅ | In | Low |
| 16 | INT̅ | In | Low (level) |
| 17 | NMI̅ | In | Falling edge |
| 26 | RESET̅ | In | Low (≥3 clocks) |
| 25 | BUSREQ̅ | In | Low |
| 23 | BUSACK̅ | Out | Low |
| 6 | CLK | In | — |
| 11 | +5 V | — | — |
| 29 | GND | — | — |

## 2. Register File ([U] Fig. 2 p. 3; [Y] §2.2 p. 8)

Main: **A, F, B, C, D, E, H, L**. Shadow (via `EX AF,AF'` / `EXX`): **A', F', B', C', D', E', H', L'**. Special: **IX, IY, SP, PC** (16-bit); **I** (IM-2 high byte); **R** (refresh).

**F bits, MSB→LSB** ([U] p. 76; [Y] §2.3 p. 8):

| 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|---|
| S | Z | **Y** | H | **X** | P/V | N | C |

[U] p. 76 marks bits 5 and 3 "Not Used"; in real silicon they are the **Y** and **X** undocumented flags (copies of result bits 5/3), readable only via `PUSH AF`. Tested by zexall — must be implemented.

## 3. R-register ([U] p. 4; [Y] §6.1 p. 23)

7-bit refresh counter, **bit 7 preserved** across increments and only changed by `LD R,A`. R increments at every M1 cycle: unprefixed op = +1; CB / DD / FD / ED prefix each = +1 (so a CB-prefixed op = +2, a DDCB / FDCB op = **+2 only** — the inner CB is *not* an M1 fetch); a stray DD/FD = +1. Block-repeat ops add 2·BC. INT and NMI accept each += 1. Reset clears R to 0.

## 4. Bus Cycles

**M1 / opcode fetch — 4 T** ([U] Fig. 5 p. 13). T1: PC→A; ½T later M1̅↓, MREQ̅↓, RD̅↓. T2: WAIT̅ sampled (insert Tw if low). T3↑: latch D, deassert RD̅/MREQ̅/M1̅; **refresh phase**: RFSH̅↓, A0..A6=R[6:0], A7=R[7], A8..A15=I, MREQ̅ pulses for DRAM. T4: decode; RFSH̅↑.

**Memory read (non-M1) — 3 T** ([U] Fig. 6 p. 14): T1 addr+MREQ̅↓+RD̅↓ → T2 (WAIT̅ sample) → T3 latch & deassert.

**Memory write — 3 T** ([U] Fig. 6): T1 addr+MREQ̅↓ → T2 data + WR̅↓ + WAIT̅ sample → T3 deassert; WR̅↑ ½T before bus changes.

**I/O read — 4 T (one mandatory Tw)** ([U] Fig. 7 p. 15): T1 port→A (BC or A·256+n) → T2 IORQ̅↓+RD̅↓ → **TW (auto, WAIT̅ sampled)** → T3 latch & deassert.

**I/O write — 4 T**: T1 → T2 IORQ̅↓+WR̅↓+data → **TW** → T3.

## 5. Reset ([U] p. 9, p. 28; [Y] §2.4 p. 9)

After RESET̅ low ≥3 clocks: **PC=0, I=0, R=0, IFF1=0, IFF2=0, IM=0**. Per Matt Westcott's hardware tests cited [Y] §2.4: real silicon also leaves **AF=FFFFh, SP=FFFFh**; all other registers are indeterminate (init to FFFFh in an emulator). Address/data/control tri-state during reset.

## 6. NMI ([U] Fig. 10 p. 18; [Y] §5.1 p. 19)

11 T-states (5+3+3): special M1 (data byte ignored, R += 1), push PCH, push PCL, jump **0066h**. **IFF1 → 0; IFF2 unchanged** ([Y] empirically corrects [U] which implies an IFF1→IFF2 copy). RETN restores IFF1 ← IFF2.

## 7. INT modes ([U] p. 24–26; [Y] §5.2 p. 19)

On accept: IFF1=IFF2=0, R += 1, M1+IORQ̅ acknowledge with **2 auto-inserted wait states**, then:
- **IM 0** — bus byte executed as instruction (typically `RST nn`; FFh = `RST 38h`). I unused. 13 T for an RST.
- **IM 1** — fixed `RST 38h` (call 0038h), bus ignored. 13 T.
- **IM 2** — vector = `(I << 8) | D`. Read 2 bytes (low then high) at that address; call the resulting pointer. **Bit 0 of D is NOT forced to 0** ([Y] §7.1 p. 24 contradicts [U] Fig. 16). 19 T.

## 8. Tricky-instruction flag rules

- **DAA** ([U] p. 166 table; [Y] §4.7 p. 17–18). Inputs: C, H, N (pre-op) + A's two nibbles → lookup `diff` ∈ {00,06,60,66,FA,A0,9A} and new C. **Add diff if N=0, subtract if N=1**. S/Z/P, Y, X from result; **N unchanged**; H per [Y]'s tables (zero unless crossing nibble).
- **CPI/CPD/CPIR/CPDR** ([U] p. 134; [Y] §4.2 p. 16). Compute n = A − (HL) − Hcomputed. **S, Z, H** = result of A−(HL); **P/V** = (BC−1 ≠ 0); **N=1**; **C unchanged**. **Y = bit 1 of n, X = bit 3 of n** (per [Y]; [U] omits).
- **RLD / RRD** ([U] p. 220, 222): S/Z by result A; H=0; P/V=parity; N=0; C unchanged.
- **NEG** ([U] p. 169): A ← 0−A. **P/V set iff A was 80h**; **C set iff A was not 0**; H from bit-4 borrow; N=1; S/Z normal.
- **Block I/O (INI/IND/INIR/INDR/OUTI/OUTD/OTIR/OTDR)** — [U] p. 272/282 marks H/P/V/S "unknown"; real silicon is fully deterministic per [Y] §4.3 p. 16:
  - S, Z, Y, X = flags of decremented B (`DEC B`).
  - N = bit 7 of the byte transferred.
  - **OUTx**: k = L_after + byte; H = C = (k > 255); P/V = parity((k & 7) XOR B).
  - **INx**: same as OUTx but substitute (C+1 for INI/INIR, C−1 for IND/INDR) for L.

## 9. MEMPTR (WZ) ([Y] §4.1 p. 15)

Internal 16-bit register, observable only through `BIT n,(HL)` (and DD/FD-prefixed BIT) which copy MEMPTR bits 13 (→Y) and 11 (→X) into F. Updated by 16-bit memory ops, ADD HL, JR, LD r,(IX+d), interrupts, etc. Required for zexall's `bit op` cases.

---

## Open questions

- **MEMPTR full update map** — [Y] §4.1 admits incomplete coverage. Cross-validate against `floooh/chips/z80.h` MEMPTR comments.
- **Reset register defaults** — AF=SP=FFFFh ([Y]) vs "indeterminate" ([U]); production emulators standardise on FFFFh.
- **IM 2 odd-byte vectors** — [Y] §7.1 contradicts [U] Fig. 16. Trust [Y]; do not mask LSB.
