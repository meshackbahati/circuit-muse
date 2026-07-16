; i8080 banner ROM — bundled chip's program.
;
; Memory map:
;   0x0000  ROM (this code)
;   0x1000  RAM (256 bytes, stack only)
;   0x2000  UART_DATA   (write TX byte)
;   0x2001  UART_STAT   (bit 0 = TX always ready)
;
; What it does:
;   prints a banner from ROM, sleeps ~50 ms, and prints a counter line
;   ("uptime ticks: NN") forever. Demonstrates the 8080 executing real
;   code (JMP, LXI, CALL, RET, DCR, conditional branch, memory access)
;   without needing UART RX — so it works cleanly even when the host AVR
;   echoes Serial traffic back into the chip's RX.

        ORG 0x0000

        LXI  SP, 0x10FF        ; stack at top of RAM
        LXI  H, banner
        CALL puts

        MVI  A, 0
        STA  0x1000             ; tick counter at 0x1000

loop:
        LXI  H, label_ticks
        CALL puts
        LDA  0x1000
        CALL prhex
        MVI  A, 0x0D
        CALL putc
        MVI  A, 0x0A
        CALL putc
        LDA  0x1000
        INR  A
        STA  0x1000
        CALL delay
        JMP  loop

; ─── delay: ~50 ms of busy-wait. At ~1 MIPS that's 50_000 instructions. ──
delay:
        LXI  H, 0x0200         ; 512 outer iters * inner 100 = ~50K instr
delay_outer:
        MVI  B, 100
delay_inner:
        DCR  B
        JNZ  delay_inner
        DCX  H
        MOV  A, H
        ORA  L
        JNZ  delay_outer
        RET

; ─── primitives ─────────────────────────────────────────────────────────
putc:
        STA  0x2000
        RET

puts:
        MOV  A, M
        CPI  0
        RZ
        CALL putc
        INX  H
        JMP  puts

prhex:
        MOV  C, A
        RRC
        RRC
        RRC
        RRC
        ANI  0x0F
        CALL prnib
        MOV  A, C
        ANI  0x0F
        CALL prnib
        RET
prnib:
        CPI  10
        JC   prnib_dig
        ADI  'A'-10
        CALL putc
        RET
prnib_dig:
        ADI  '0'
        CALL putc
        RET

; ─── strings ───────────────────────────────────────────────────────────
banner:
        DB "\r\n"
        DB "  ===========================================\r\n"
        DB "   velxio i8080 - clean-room Intel 8080A in WASM\r\n"
        DB "   Booted from a 200-byte embedded ROM image\r\n"
        DB "  ===========================================\r\n"
        DB "\r\n", 0

label_ticks:
        DB "  uptime ticks: 0x", 0
