; i8080 button-counter ROM.
;
; Memory map:
;   0x0000  ROM (this code)
;   0x1000  RAM (256 bytes)
;   0x2000  LED_OUT     (write to set 8 LED pin states)
;   0x2002  BTN_IN      (read 8 button pin states)
;   0x2003  EDGE_FLAGS  (bit 0 = rising edge on BTN_INC since last read,
;                        bit 1 = rising edge on BTN_RST since last read.
;                        Reads clear both flags.)
;
; Behaviour:
;   * counter init to 0
;   * on each rising edge of BTN_INC, counter++ (wraps at 0xFF)
;   * on each rising edge of BTN_RST, counter = 0
;   * counter is always written to LED_OUT
;
; BTN_INC is pin 0 of the button port (so EDGE_FLAGS bit 0).
; BTN_RST is pin 1 of the button port (so EDGE_FLAGS bit 1).

        ORG 0x0000

        LXI  SP, 0x10FF
        MVI  C, 0                ; C = counter
        MOV  A, C
        STA  0x2000              ; clear LEDs

loop:
        LDA  0x2003              ; read edge flags (clears them)
        MOV  B, A                ; B = edges

        ; rising edge on BTN_INC?
        ANI  0x01
        JZ   no_inc
        INR  C
no_inc:
        ; rising edge on BTN_RST?
        MOV  A, B
        ANI  0x02
        JZ   no_rst
        MVI  C, 0
no_rst:
        ; show counter on LEDs
        MOV  A, C
        STA  0x2000
        JMP  loop
