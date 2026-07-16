; Quick smoke test for the Z80 assembler.
        ORG 0x0000

        LD   SP, 0xBFFF
        LD   A, 0x55
        LD   (0xC000), A      ; write to LED port
loop:
        LD   B, 0
delay:
        DJNZ delay
        LD   A, (0xC003)       ; read buttons
        XOR  0xFF
        LD   (0xC000), A
        JR   loop
