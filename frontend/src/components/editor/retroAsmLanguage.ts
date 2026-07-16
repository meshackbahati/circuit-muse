/**
 * Monaco language definition for retro CPU assembly (Intel 8080 + Zilog Z80).
 *
 * Used when the editor opens a .s / .asm file in a Velxio project — the
 * `/api/compile-rom` backend then assembles it into a ROM image for the
 * programmable i8080-cpu / z80-cpu chip.
 *
 * Covers the union of 8080 + Z80 mnemonics so a single highlighter works
 * for both targets. Directives (ORG / DB / DW / EQU), labels, hex/binary
 * literals, character constants, and ; comments are recognised.
 */

import type * as monacoNs from 'monaco-editor';

export const LANGUAGE_ID = 'retro-asm';

const MNEMONICS_8080 = [
  // Loads / moves
  'MOV', 'MVI', 'LXI', 'LDA', 'STA', 'LDAX', 'STAX', 'LHLD', 'SHLD', 'XCHG',
  // Stack / sp
  'PUSH', 'POP', 'XTHL', 'SPHL',
  // ALU r / immediate
  'ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP',
  'ADI', 'ACI', 'SUI', 'SBI', 'ANI', 'XRI', 'ORI', 'CPI',
  // Inc/Dec
  'INR', 'DCR', 'INX', 'DCX', 'DAD',
  // Rotates / misc
  'RLC', 'RRC', 'RAL', 'RAR', 'CMA', 'STC', 'CMC', 'DAA',
  // Control flow
  'JMP', 'JC', 'JNC', 'JZ', 'JNZ', 'JP', 'JM', 'JPO', 'JPE', 'PCHL',
  'CALL', 'CC', 'CNC', 'CZ', 'CNZ', 'CP', 'CM', 'CPO', 'CPE',
  'RET', 'RC', 'RNC', 'RZ', 'RNZ', 'RP', 'RM', 'RPO', 'RPE',
  'RST', 'NOP', 'HLT',
  // Interrupts / IO
  'EI', 'DI', 'IN', 'OUT',
];

const MNEMONICS_Z80_EXTRA = [
  // Z80-only additions on top of 8080-equivalent shapes
  'LD', 'JR', 'DJNZ', 'EX', 'EXX', 'HALT',
  // CB-prefix bit ops
  'BIT', 'SET', 'RES', 'RL', 'RR', 'SLA', 'SRA', 'SRL',
  // ED-prefix
  'NEG', 'RETI', 'RETN', 'LDI', 'LDIR', 'LDD', 'LDDR', 'CPI', 'CPIR', 'CPD', 'CPDR',
  'INI', 'INIR', 'IND', 'INDR', 'OUTI', 'OTIR', 'OUTD', 'OTDR',
  'IM',
  // Index-register helpers (DD/FD prefix)
  'IX', 'IY',
];

const DIRECTIVES = ['ORG', 'DB', 'DW', 'DS', 'EQU', 'END', 'INCLUDE', 'MACRO', 'ENDM'];

const REGISTERS = [
  // 8-bit
  'A', 'B', 'C', 'D', 'E', 'H', 'L', 'F',
  // 8080 alt
  'M', 'PSW',
  // 16-bit
  'AF', 'BC', 'DE', 'HL', 'SP', 'PC', 'IX', 'IY', 'IR',
  // Z80 condition codes (also keywords in some contexts)
  'NZ', 'Z', 'NC', 'PO', 'PE',
];

export const LANGUAGE_CONFIG: monacoNs.languages.LanguageConfiguration = {
  comments: { lineComment: ';' },
  brackets: [['(', ')']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const MONARCH_TOKENIZER: monacoNs.languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: '',
  tokenPostfix: '.retro-asm',

  keywords: [...MNEMONICS_8080, ...MNEMONICS_Z80_EXTRA],
  directives: DIRECTIVES,
  registers: REGISTERS,

  tokenizer: {
    root: [
      // Label at start of line.
      [/^[ \t]*([A-Za-z_$][\w$]*)\s*:/, 'type.identifier'],

      // Comments.
      [/;.*$/, 'comment'],

      // Char literal: 'X' (single char).
      [/'(?:\\.|[^'])'/, 'string'],

      // String literal in DB.
      [/"[^"]*"/, 'string'],

      // Hex literals — both 0xNN and NNh.
      [/0[xX][0-9A-Fa-f]+/, 'number.hex'],
      [/[0-9A-Fa-f]+[hH]\b/, 'number.hex'],
      // Binary literals — 0b... or NNb
      [/0[bB][01]+/, 'number.binary'],
      [/[01]+[bB]\b/, 'number.binary'],
      // Decimal literals.
      [/\d+/, 'number'],

      // Identifiers — disambiguate keyword vs register vs directive vs label use.
      [/[A-Za-z_$][\w$]*/, {
        cases: {
          '@keywords':   'keyword',
          '@directives': 'keyword.control',
          '@registers':  'variable.predefined',
          '@default':    'identifier',
        },
      }],

      // Symbols + operators
      [/[,:()+\-*/&|^~!]/, 'delimiter'],
      [/[ \t]+/, ''],
    ],
  },
};

/** One-shot registration. Call once on app boot from Monaco's beforeMount. */
export function registerRetroAsm(monaco: typeof monacoNs): void {
  // Languages are global — don't re-register if already there.
  const langs = monaco.languages.getLanguages();
  if (langs.some((l) => l.id === LANGUAGE_ID)) return;

  monaco.languages.register({
    id: LANGUAGE_ID,
    extensions: ['.s', '.asm'],
    aliases: ['Retro Assembly', 'retro-asm', '8080 asm', 'Z80 asm'],
  });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, LANGUAGE_CONFIG);
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, MONARCH_TOKENIZER);
}
