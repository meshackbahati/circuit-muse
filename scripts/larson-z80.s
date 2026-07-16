; Larson Scanner / Knight Rider in Z80 assembly.
;
; A single LED walks left across 8 LEDs forever. Uses JR/DJNZ/RLCA — all
; Z80-friendly instructions. Visually iconic ~1980s look.

        ORG 0x0000

        LD   SP, 0xBFFF        ; stack at top of RAM
        LD   A, 0x01           ; A = bit pattern (start at LED0)

loop:
        LD   (0xC000), A       ; write to LED port
        PUSH AF
        CALL delay
        POP  AF
        RLCA                   ; rotate left (bit 7 → bit 0)
        JR   loop

; ─── delay: ~80 ms outer loop using DJNZ + DEC ─────────────────────────
delay:
        LD   C, 80
outer:
        LD   B, 0              ; 0 means 256 inner iterations (DJNZ underflows)
inner:
        DJNZ inner
        DEC  C
        JR   NZ, outer
        RET
