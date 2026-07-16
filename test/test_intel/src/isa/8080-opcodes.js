/**
 * Intel 8080 opcodes — selected, byte-accurate constants for tests.
 *
 * Source: Intel 8080 Programmer's Manual (1975, public Intel publication).
 * Names follow the standard mnemonics. Multi-byte instructions list only
 * the leading byte; tests append the operand bytes inline.
 *
 * This is intentionally NOT a complete table — it's a tested sub-set
 * sufficient for the unit tests in test_8080/. Add more as tests grow.
 */
export const I8080 = {
  // Data movement, register-direct
  MOV_A_A: 0x7F, MOV_A_B: 0x78, MOV_A_C: 0x79, MOV_A_D: 0x7A, MOV_A_E: 0x7B,
  MOV_A_H: 0x7C, MOV_A_L: 0x7D, MOV_A_M: 0x7E,
  MOV_B_A: 0x47, MOV_C_A: 0x4F, MOV_D_A: 0x57, MOV_E_A: 0x5F,
  MOV_H_A: 0x67, MOV_L_A: 0x6F, MOV_M_A: 0x77,

  // Move immediate (one operand byte follows)
  MVI_A:   0x3E, MVI_B:   0x06, MVI_C:   0x0E, MVI_D:   0x16,
  MVI_E:   0x1E, MVI_H:   0x26, MVI_L:   0x2E, MVI_M:   0x36,

  // Load 16-bit immediate (LSB then MSB follow)
  LXI_B:   0x01, LXI_D:   0x11, LXI_H:   0x21, LXI_SP:  0x31,

  // Direct memory addressing (16-bit addr operand, LSB first)
  STA:     0x32, LDA:     0x3A, SHLD:    0x22, LHLD:    0x2A,

  // Indirect via register pair
  STAX_B:  0x02, STAX_D:  0x12, LDAX_B:  0x0A, LDAX_D:  0x1A,

  // Arithmetic (8-bit)
  ADD_B:   0x80, ADD_C:   0x81, ADD_D:   0x82, ADD_E:   0x83,
  ADD_H:   0x84, ADD_L:   0x85, ADD_M:   0x86, ADD_A:   0x87,
  ADC_B:   0x88,
  SUB_B:   0x90, SUB_C:   0x91,
  SBB_B:   0x98,
  ANA_B:   0xA0, XRA_B:   0xA8, ORA_B:   0xB0, CMP_B:   0xB8,

  // Immediate arithmetic (one operand byte)
  ADI:     0xC6, ACI:     0xCE, SUI:     0xD6, SBI:     0xDE,
  ANI:     0xE6, XRI:     0xEE, ORI:     0xF6, CPI:     0xFE,

  // Increment / decrement
  INR_A:   0x3C, INR_B:   0x04, INR_C:   0x0C, INR_D:   0x14,
  INR_E:   0x1C, INR_H:   0x24, INR_L:   0x2C, INR_M:   0x34,
  DCR_A:   0x3D, DCR_B:   0x05,
  INX_B:   0x03, INX_D:   0x13, INX_H:   0x23, INX_SP:  0x33,
  DCX_B:   0x0B, DCX_D:   0x1B, DCX_H:   0x2B, DCX_SP:  0x3B,

  // Rotates
  RLC:     0x07, RRC:     0x0F, RAL:     0x17, RAR:     0x1F,

  // 16-bit add into HL
  DAD_B:   0x09, DAD_D:   0x19, DAD_H:   0x29, DAD_SP:  0x39,

  // Decimal adjust + complement / flag ops
  DAA:     0x27, CMA:     0x2F, STC:     0x37, CMC:     0x3F,

  // Control flow — unconditional (16-bit addr operand)
  JMP:     0xC3, CALL:    0xCD, RET:     0xC9,

  // Conditional jumps / calls / returns
  JNZ:     0xC2, JZ:      0xCA, JNC:     0xD2, JC:      0xDA,
  JPO:     0xE2, JPE:     0xEA, JP:      0xF2, JM:      0xFA,
  CNZ:     0xC4, CZ:      0xCC, CNC:     0xD4, CC:      0xDC,
  CPO:     0xE4, CPE:     0xEC, CP:      0xF4, CM:      0xFC,
  RNZ:     0xC0, RZ:      0xC8, RNC:     0xD0, RC:      0xD8,
  RPO:     0xE0, RPE:     0xE8, RP:      0xF0, RM:      0xF8,

  // Stack
  PUSH_B:  0xC5, PUSH_D:  0xD5, PUSH_H:  0xE5, PUSH_PSW: 0xF5,
  POP_B:   0xC1, POP_D:   0xD1, POP_H:   0xE1, POP_PSW:  0xF1,
  XTHL:    0xE3, SPHL:    0xF9, PCHL:    0xE9, XCHG:     0xEB,

  // I/O (one operand byte = port number)
  IN:      0xDB, OUT:     0xD3,

  // Interrupt control
  EI:      0xFB, DI:      0xF3,

  // Restart vectors
  RST_0:   0xC7, RST_1:   0xCF, RST_2:   0xD7, RST_3:   0xDF,
  RST_4:   0xE7, RST_5:   0xEF, RST_6:   0xF7, RST_7:   0xFF,

  // Halt and no-op
  NOP:     0x00, HLT:     0x76,
};

/** Status-byte values the 8080 emits on D0..D7 during T1 (real chip). */
export const I8080_STATUS = {
  INTA:        0b00100011,  // interrupt-acknowledge
  WO:          0b00010000,  // write output (active LOW for writes — 0 = write)
  STACK:       0b00000100,
  HLTA:        0b00001000,
  OUT:         0b00010000,
  M1:          0b00100000,
  INP:         0b01000000,
  MEMR:        0b10000000,
};

/** Helper: assemble a small program from mnemonic-tagged tuples. */
export function asm(...parts) {
  const out = [];
  for (const p of parts) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return Uint8Array.from(out);
}

/** Split a 16-bit value into [LSB, MSB] for use with LXI / JMP / CALL / etc. */
export function imm16(v) {
  return [v & 0xff, (v >> 8) & 0xff];
}
