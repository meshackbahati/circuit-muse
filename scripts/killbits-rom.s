; Kill the Bit -- Dean McDaniel, May 15, 1975. Public domain.
;
; The classic Altair 8800 front-panel reflex game. Adapted to Velxio's
; i8080-cpu chip: instead of the Altair's address LEDs + sense switches,
; we use the chip's memory-mapped LED port (0xC000) and button bitmap
; (0xC003).
;
; How to play: a single LED walks left across the 8 LEDs. Press the
; button at the SAME bit position as the lit LED to "kill" it. Miss,
; and an extra bit lights up next time around.
;
; Logic per beat:
;   1. Wait some cycles (DAD B + JNC beat).
;   2. Show the current bit pattern (register D) on the LEDs.
;   3. Read which buttons the user is pressing.
;   4. XOR with D -- bits the user pressed at the right time get cleared.
;   5. Rotate right -- advances the bit one position.

        ORG 0x0000

        LXI  SP, 0xBFFF      ; stack at top of RAM (we don't push, but safe)
        LXI  H, 0x0000       ; clear delay accumulator
        MVI  D, 0x80         ; D = current bit pattern (start: LED7 lit)
        LXI  B, 0x0E00       ; B/C = delay step

beat:
        DAD  B               ; HL += BC; loops ~18 times before carry
        JNC  beat

        ; One "tick" -- show D on LEDs, sample button, advance bit.
        MOV  A, D
        STA  0xC000          ; LEDs <- D

        LDA  0xC003          ; A = button bitmap
        XRA  D               ; bits the user got right are toggled OFF
        RRC                  ; rotate right (bit0 -> bit7)
        MOV  D, A

        JMP  beat
