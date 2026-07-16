/*
 * Linker script for ESP32-C3 bare-metal blink.
 *
 * Places .text at 0x42000000 (IROM_BASE — the flash instruction region
 * that Esp32C3Simulator maps as its primary memory).
 * Stack lives at the top of DRAM (0x3FC80000 + 384KB).
 */
OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY {
    IROM (rx)  : ORIGIN = 0x42000000, LENGTH = 4M
    DRAM (rwx) : ORIGIN = 0x3FC80000, LENGTH = 384K
}

SECTIONS {
    .text 0x42000000 : {
        KEEP(*(.text.startup))
        *(.text*)
        *(.rodata*)
    } > IROM

    .data : {
        *(.data*)
    } > DRAM AT > IROM

    .bss : {
        *(.bss*)
        *(COMMON)
    } > DRAM

    /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }
}
