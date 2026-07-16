# 8086 Authoritative Spec (for Velxio Emulator)

Primary source: **Intel, *The 8086 Family User's Manual*, October 1979** (order
9800722-03), located at `pdfs/iapx_86_88_users_manual.pdf` in this folder. All
page citations use the PDF page index in parentheses followed by the manual
section number that appears on the page (Intel uses chapter-relative numbering
like "2-25", "4-2"). Where the manual is silent or ambiguous, the *iAPX 86,88
User's Manual, 1981 edition* (a superset) is consulted by reference; no
disagreements were found in the parts that overlap.

---

## 1. Pin Contract — 40-pin DIP, Minimum Mode (MN/MX = Vcc)

From figure 4-1 (PDF p.240, manual p.4-2). All 40 pins of the 8086 are listed.

**Common pins (both modes)**

| Pin | Name | Type | Function |
|-----|------|------|----------|
| 2-16, 39 | AD15-AD0 | Bidirectional, 3-state | Time-multiplexed address (T1) / data (T2-T4) |
| 35-38 | A19/S6 - A16/S3 | Output, 3-state | Upper address bits in T1; status thereafter |
| 34 | BHE/S7 | Output, 3-state | Bus High Enable in T1 (low = upper byte valid) |
| 33 | MN/MX | Input | Strap: Vcc = minimum mode, GND = maximum |
| 32 | RD | Output, 3-state | Read strobe (active low) |
| 23 | TEST | Input | WAIT instruction polls this (active low) |
| 22 | READY | Input | Wait-state insertion (sampled in T3) |
| 21 | RESET | Input | Active high; min 4 CLK cycles (50 µs at power-up) |
| 17 | NMI | Input | Rising edge, vector 2 |
| 18 | INTR | Input | Level, maskable by IF |
| 19 | CLK | Input | 33% duty, 5/8/10 MHz |
| 40 | Vcc / 1, 20 | GND | Power |

**Min-mode-only pins (24-31)** — Table 4-1 (PDF p.249, manual p.4-11):

| Pin | Min Mode | Maximum-mode alias |
|-----|----------|--------------------|
| 31 | HOLD | RQ/GT0 |
| 30 | HLDA | RQ/GT1 |
| 29 | WR | LOCK |
| 28 | M/IO | S2 |
| 27 | DT/R | S1 |
| 26 | DEN | S0 |
| 25 | ALE | QS0 |
| 24 | INTA | QS1 |

ALE pulses high once per bus cycle, valid trailing edge in T1 (PDF p.245,
manual p.4-7). DEN gates the bidirectional bus transceiver; DT/R selects
direction (1 = transmit/write, 0 = receive/read). M/IO is high for memory,
low for I/O on the 8086 (the **8088 inverts this signal as IO/M**, PDF p.249).

---

## 2. Reset State

From "System Reset" (PDF p.51, manual p.2-29) and Table 2-4 referenced there.
RESET must be held high for ≥ 4 CLK cycles (≥ 50 µs at power-up). When RESET
goes low, the CPU initializes:

| Component | Value at reset |
|-----------|----------------|
| Flags | clear (0x0000; reserved bits per Fig 2-9 are 1, see §5) |
| IP | 0x0000 |
| CS | 0xFFFF |
| DS | 0x0000 |
| SS | 0x0000 |
| ES | 0x0000 |
| Instruction queue | empty |

First fetched physical address = `CS:IP = FFFF:0000` → physical `0xFFFF0`
(PDF p.51 / manual p.2-29). Typical ROM holds an inter-segment JMP there.
NMI/INTR/HOLD are ignored while RESET is active. HOLD is honored immediately
after RESET deasserts if asserted (PDF p.252, manual p.4-14).

---

## 3. Bus Cycle T1-T4 (Minimum Mode)

From "Bus Operation" (PDF pp.244-247, manual pp.4-6 to 4-9), figures 4-7
through 4-10. One bus cycle = 4 CLK states T1, T2, T3, T4. Wait states Tw are
inserted between T3 and T4 when READY is sampled low in T3 (PDF p.244).

| State | AD15-AD0 | A19/S6-A16/S3 | ALE | RD/WR | DT/R | DEN | M/IO |
|-------|----------|---------------|-----|-------|------|-----|------|
| T1 | 20-bit address out (with BHE) | address out | high pulse | inactive | set early | inactive | valid |
| T2 | float (read) or write data out | status S3-S6 | low | RD or WR active | stable | active | held |
| T3 | data sampled (read) or held (write) | status | low | active | stable | active | held |
| Tw | bus held; READY polled | status | low | active | stable | active | held |
| T4 | bus released | status | low | inactive | — | inactive | inactive |

Status lines S3-S4 indicate which segment was used (Table 2-7, PDF p.52):
00 = ES, 01 = SS, 10 = CS or none, 11 = DS. S5 mirrors IF, S6 = 0 (8086).

S2-S0 in maximum mode encode the cycle type (Table 2-6, PDF p.52 / Table 4-2,
PDF p.250): 000 = INTA, 001 = I/O read, 010 = I/O write, 011 = HALT,
100 = code fetch, 101 = mem read, 110 = mem write, 111 = passive.

---

## 4. 20-Bit Address Arithmetic

From "Physical Address Generation" (PDF pp.34-35, manual pp.2-12 to 2-13),
figure 2-18:

```
physical = (segment << 4) + offset    (modulo 0x100000 — wraps at 1 MB)
```

The segment is shifted left 4 bits (multiplied by 16), then the 16-bit offset
is added. Carry out of bit 19 wraps. Inside a single 64 KB segment, the offset
arithmetic itself is modulo 0x10000 (PDF p.34, manual p.2-12: "addresses wrap
around from the end of a segment to the beginning of the same segment").

---

## 5. Default Segments and Override Prefixes

From Table 2-2 "Logical Address Sources" (PDF p.35, manual p.2-13):

| Reference type | Default seg | Offset | Allowed overrides |
|----------------|-------------|--------|-------------------|
| Instruction fetch | CS | IP | none |
| Stack push/pop, call/ret | SS | SP | none |
| BP used as base reg | SS | EA | CS, DS, ES |
| Data variable (other) | DS | EA | CS, ES, SS |
| String source (SI) | DS | SI | CS, ES, SS |
| String destination (DI) | ES | DI | none |

Override prefixes (one byte, applies to next instruction):
`0x26 = ES:`, `0x2E = CS:`, `0x36 = SS:`, `0x3E = DS:` (manual p.2-13 and
encoding table 4-12, PDF p.260+). The general SR encoding is
`00=ES, 01=CS, 10=SS, 11=DS` (Table 4-11, PDF p.259).

---

## 6. ModR/M Decode (Tables 4-8, 4-9, 4-10; PDF p.258, manual p.4-20)

The instruction's second byte is `mod (2) | reg (3) | r/m (3)`.

**MOD field** (Table 4-8):
```
00 = memory mode, no displacement       (special: r/m=110 → 16-bit disp16 direct)
01 = memory mode, sign-extended 8-bit displacement
10 = memory mode, 16-bit displacement
11 = register mode (r/m selects the register)
```

**REG field** (Table 4-9) — w-bit selects byte vs word register:

| REG | w=0 | w=1 |
|-----|-----|-----|
| 000 | AL  | AX  |
| 001 | CL  | CX  |
| 010 | DL  | DX  |
| 011 | BL  | BX  |
| 100 | AH  | SP  |
| 101 | CH  | BP  |
| 110 | DH  | SI  |
| 111 | BH  | DI  |

**R/M effective-address table** (Table 4-10, manual p.4-20). When MOD ≠ 11:

| R/M | Effective address |
|-----|-------------------|
| 000 | (BX)+(SI)+disp |
| 001 | (BX)+(DI)+disp |
| 010 | (BP)+(SI)+disp  *(default seg = SS)* |
| 011 | (BP)+(DI)+disp  *(default seg = SS)* |
| 100 | (SI)+disp |
| 101 | (DI)+disp |
| 110 | (BP)+disp  *(default SS;* if MOD=00 → disp16 absolute, default DS *)* |
| 111 | (BX)+disp |

Default segment for any addressing mode that uses BP as a base is SS; all
others default to DS. Segment-override prefix overrides this.

---

## 7. Flag Register Layout

From "Flags" (manual pp.2-7 to 2-8) and figure 2-9 (referenced PDF p.30,
manual p.2-8). The 16-bit flag register is laid out as:

```
bit 15 14 13 12 11 10 9  8  7  6  5  4  3  2  1  0
     -  -  -  -  OF DF IF TF SF ZF -  AF -  PF -  CF
```

Bits 1, 3, 5, 12-15 are reserved; bit 1 reads as 1 on real hardware (the 1979
manual is silent on the reserved-bit encoding — a known **disagreement**:
8086tiny treats them as 0, MartyPC and the 8088 V2 SingleStepTests
canonicalize bit 1 = 1, bits 12-15 = 1 on reset. Both agree all other bits
clear at reset.)

Per-flag rules (PDF pp.57-58, manual pp.2-35 to 2-36):

- **CF**: carry-out of MSB on add; borrow into MSB on sub. Used by ADC/SBB.
- **AF**: carry-out of bit 3 on add; borrow into bit 3 on sub. Used only by
  decimal-adjust instructions.
- **SF**: copy of bit 7/15 of result.
- **ZF**: 1 if result == 0.
- **PF**: even parity over the **low 8 bits** of the result.
- **OF**: signed overflow (XOR of carry-into-MSB and carry-out-of-MSB).
- **DF**: 0 = string ops auto-increment SI/DI; 1 = decrement.
- **IF**: 1 = INTR enabled.
- **TF**: 1 = single-step (INT 1 after each instruction).

---

## 8. Variable-Length Instruction Format

From manual §4.2, "Machine Instruction Encoding" (PDF p.258+). Up to 6 bytes,
in this order:

```
[ prefix ]*  opcode (1-2 bytes)  [ ModR/M ]  [ disp lo,hi ]  [ imm lo,hi ]
```

Prefix bytes: segment override (0x26/2E/36/3E), LOCK (0xF0), REP/REPE
(0xF3), REPNE (0xF2). Multiple prefixes are allowed but the CPU "remembers"
only one per category (PDF p.64, manual p.2-42); on interrupted REP+segov
the segment override is dropped on resume.

Displacement encoding (Table 4-11 key, PDF p.259): little-endian; an 8-bit
displacement is sign-extended to 16 bits before EA addition. Immediates
likewise little-endian, with sign-extension controlled by the `s` bit in
arithmetic encodings.

---

## 9. Decimal-Adjust and ASCII-Adjust Flag Rules

From PDF pp.57-58 (manual pp.2-35 to 2-37) and the instruction reference
table 2-21 (PDF p.73, manual p.2-51) which gives the canonical "flags
affected" mask `ODITSZAPC` (each letter = 1 flag) per instruction.

| Insn | Flags | OF | SF | ZF | AF | PF | CF |
|------|-------|----|----|----|----|----|----|
| AAA  | OSZP undefined; AF, CF defined | U | U | U | X | U | X |
| AAS  | OSZP undefined; AF, CF defined | U | U | U | X | U | X |
| AAM  | OAC undefined; SZP defined | U | X | X | U | X | U |
| AAD  | OAC undefined; SZP defined | U | X | X | U | X | U |
| DAA  | OF undefined; AF/CF/PF/SF/ZF defined | U | X | X | X | X | X |
| DAS  | OF undefined; AF/CF/PF/SF/ZF defined | U | X | X | X | X | X |
| MUL  | SF/ZF/AF/PF undefined; OF=CF=(AH≠0) for byte, (DX≠0) for word | X | U | U | U | U | X |
| IMUL | SF/ZF/AF/PF undefined; OF=CF=(sign-extend mismatch) | X | U | U | U | U | X |
| DIV  | all six arithmetic flags **undefined** | U | U | U | U | U | U |
| IDIV | all six arithmetic flags **undefined** | U | U | U | U | U | U |

DAA pseudocode (manual p.2-36, PDF p.58):
```
old_AL = AL;  old_CF = CF
if (AL & 0x0F) > 9 OR AF=1 :  AL += 6;  AF=1;  CF |= (AL overflowed)
if old_AL > 0x99 OR old_CF=1 : AL += 0x60;  CF=1
```
DAS is the symmetric subtract form. Adrian Cable's 8086tiny and Daniel
Balsom's MartyPC both implement this exact pseudocode; they disagree only on
flag-after-DAA OF (manual says undefined; tinyemus typically leave it
unchanged).

---

## 10. String-Op + REP Flag/Counter Rules

From "String Instructions" (manual pp.2-41 to 2-43, PDF pp.63-65).

Each iteration:
1. If CX = 0, fall through immediately (no flag/index changes).
2. Execute one MOVS / CMPS / SCAS / LODS / STOS.
3. Decrement CX by 1 (no flag effect from this decrement).
4. Adjust SI/DI by ±1 (byte) or ±2 (word); sign = -1 if DF=1 else +1.
5. For CMPS/SCAS only: check ZF — REPE/REPZ exits when ZF=0;
   REPNE/REPNZ exits when ZF=1.
6. For MOVS/STOS/LODS: no ZF check; exit only when CX = 0.

Interruptibility: the CPU samples INTR between iterations (manual p.2-42);
on interrupt, IP is rolled back to the prefix byte so the REP resumes after
IRET, but only the **last-seen** prefix among LOCK/segov/REP survives — a
known erratum quoted on PDF p.64.

---

## Sources & Disagreements Flagged

1. Reserved-flag-bit encoding: 1979 iAPX manual silent; SingleStepTests
   8088 V2 suite canonicalizes bit 1 = 1.
2. DAA effect on OF: manual says undefined; 8086tiny leaves OF unchanged,
   MartyPC follows the manual literally and writes a random value.
3. POP CS (opcode 0x0F) is **not documented** in the 1979 manual but is a
   known real-hardware behavior on 8086 only (8088 ignores it differently).
   See `16_8086_reference_implementations.md` §"Cross-checked edge cases".
