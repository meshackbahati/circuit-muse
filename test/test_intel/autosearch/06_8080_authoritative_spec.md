# Intel 8080 Authoritative Specification

Sources (downloaded from bitsavers.org, copies in `autosearch/pdfs/`):

- **[U]** *8080 Microcomputer Systems User's Manual*, Sept 1975, doc 98-153B.
- **[P]** *8080/8085 Assembly Language Programming Manual*, May 1981, doc 9800301D.

---

## 1. Status byte D0..D7 during T1

[U] p. 2-6, "Status Information Definition" + Table 2-1 "8080 Status Bit Definitions":

| Bit | Name (verbatim short) |
|-----|----|
| D0  | INTA — "Acknowledge signal for INTERRUPT request." |
| D1  | WO — write/output if 0, read/input if 1 (active LOW) |
| D2  | STACK — address bus holds Stack Pointer |
| D3  | HLTA — "Acknowledge signal for HALT instruction." |
| D4  | OUT — output device address on bus |
| D5  | M1 — "fetch cycle for the first byte of an instruction." |
| D6  | INP — input device address on bus |
| D7  | MEMR — "data bus will be used for memory read data." |

Hex per machine cycle, from Table 2-1 [U] p. 2-6 and 8228 STATUS WORD CHART [U] p. 5-9 (bits D7..D0):

| Cycle | INTA WO STK HLTA OUT M1 INP MEMR | Hex |
|---|---|---|
| Fetch (M1)     | 0 1 0 0 0 1 0 1 | **0xA2** |
| Memory Read    | 0 1 0 0 0 0 0 1 | **0x82** |
| Memory Write   | 0 0 0 0 0 0 0 0 | **0x00** |
| Stack Read     | 0 1 1 0 0 0 0 1 | **0x86** |
| Stack Write    | 0 0 1 0 0 0 0 0 | **0x04** |
| Input Read     | 0 1 0 0 0 0 1 0 | **0x42** |
| Output Write   | 0 0 0 0 1 0 0 0 | **0x10** |
| INT Acknowl.   | 1 1 0 0 0 1 0 0 | **0x23** |
| Halt Acknowl.  | 0 1 0 1 0 0 0 1 | **0x8A** |
| Halt + INTA    | 1 1 0 1 0 1 0 0 | **0x2B** |

## 2. Auxiliary Carry (AC) flag

[P] p. 1-11/1-12: "The auxiliary carry flag indicates a carry out of bit 3 of the accumulator." "...affected by all add, subtract, increment, decrement, compare, and all logical AND, OR, and exclusive OR instructions."

- **ADD/ADC/ADI/ACI**: AC = carry out of bit 3.
- **SUB/SBB/SUI/SBI/CMP/CPI**: AC = carry out of bit 3 of the 2's-complement add ([P] p. 3-64 example). AC is NOT inverted to a borrow like CY is.
- **INR/DCR**: AC = carry from bit 3; CY untouched ([P] p. 3-25).
- **ANA/ANI** — 8080-specific [P] p. 1-12 verbatim: *"The 8080 logical AND instructions set the flag to reflect the **logical OR of bit 3 of the values involved in the AND operation**."* → `AC = ((A | operand) >> 3) & 1`. 8085 sets AC=1; 8080 does NOT.
- **ORA/ORI, XRA/XRI**: [P] pp. 3-39, 3-65: "The carry and auxiliary carry flags are reset to zero." → AC = 0.

## 3. DAA semantics

[P] p. 3-18/3-19 verbatim:
> "1. If the least significant four bits of the accumulator have a value greater than nine, **or if the auxiliary carry flag is ON**, DAA adds six to the accumulator.
> 2. If the most significant four bits of the accumulator have a value greater than nine, **or if the carry flag is ON**, DAA adds six to the most significant four bits of the accumulator."

Flags affected: **Z, S, P, CY, AC**. AC is set from bit-3 carry of step 1; CY is set from bit-7 carry of step 2. **CY is only ever set by DAA, never cleared** — a pre-existing CY=1 forces step 2 even if the high nibble ≤ 9. Step 2's high-nibble test uses the high nibble *after* step 1.

## 4. Reset state

[U] p. 2-13 verbatim:
> "An external RESET signal ... restores the processor's internal program counter to zero. ... Note, however, that the RESET has no effect on status flags, or on any of the processor's working registers (accumulator, registers, or stack pointer). The contents of these registers remain indeterminate, until initialized explicitly by the program."

So: **PC = 0x0000**. **SP, A, B, C, D, E, H, L, all flags: UNDEFINED.** INTE is reset to 0 by RESET ([U] Fig. 2-4).

## 5. Interrupt Acknowledge cycle

[U] p. 2-11 verbatim:
> "The INTERRUPT machine cycle ... resembles an ordinary FETCH machine cycle in most respects. The M1 status bit is transmitted as usual ... accompanied, however, by an INTA status bit (D0) ... the counter itself is not incremented during the INTERRUPT machine cycle ... the peripheral logic [must] see that an eight-bit interrupt instruction is 'jammed' onto the processor's data bus during state T3."

Status word during INTA = **0x23**. CPU reads a 1-byte opcode at T3 — typically RST n (0xC7/CF/D7/DF/E7/EF/F7/FF). Multi-byte CALL allowed if hardware supplies the rest.

## 6. OUT / IN port bus behavior

[P] p. 3-41 OUT verbatim:
> "...places the contents of the accumulator on the eight-bit data bus and the number of the selected port on the sixteen-bit address bus. **Since the number of ports ranges from 0 through 255, the port number is duplicated on the address bus.**"

→ **A0..A7 = n AND A8..A15 = n** during both IN n and OUT n.

## 7. HLT behavior

[U] p. 2-13/2-14, "Halt Sequences" + Fig. 2-11: "When a halt instruction (HLT) is executed, the CPU enters the halt state (TWH) after state T2 of the next machine cycle..."

The HLT instruction's M2 cycle: T1 emits status **0x8A** (HLTA=1), then T2, then TWH... TWH... until exit. **HLTA is emitted exactly once on entry**; TWH is a continuous wait state with no new SYNC/status. If an interrupt arrives during halt (INTE=1), the next cycle is HALT+INTA with status **0x2B**.

