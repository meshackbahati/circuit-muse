# CYW43 gSPI bus protocol — emulator-eye view

Source-of-truth references:
- Infineon CYW43439 datasheet v05.00 (Sept 2023) §3.5–3.7
- `pico-sdk/src/rp2_common/pico_cyw43_driver/cyw43_bus_pio_spi.{c,pio}` (BSD-3)
- `georgerobotics/cyw43-driver/src/cyw43_ll.c` (RP-noncommercial)
- `iosoft/picowi` (MIT) — the cleanest annotated re-implementation

Everything below is the **emulator side** — what the host driver writes
and what we must answer. We do NOT have to implement the chip-side logic
(MAC layer, scan/auth/assoc state machines); we have to mimic its
visible bus behaviour up to a level the driver accepts.

## Wiring

```
RP2040 GPIO 23  ─────►  WL_REG_ON   (1 = chip powered)
RP2040 GPIO 25  ─────►  CS#         (active low)
RP2040 GPIO 29  ─────►  CLK         (gSPI clock, side-set from PIO)
RP2040 GPIO 24  ◄────►  DATA bidirectional (host writes, then releases for read)
                        also: IRQ asserted by chip when input mode
```

PIO program: `cyw43_bus_pio_spi.pio` from pico-sdk. Three flavours
(`spi_gap0_sample1`, `spi_gap01_sample0`, `spi_gap010_sample1`) — they
differ only in clock-edge sampling timing. Side-set bit toggles CLK
between instructions; the program shifts 32 bits MSB-first per word
*and* swaps high/low halfwords for the wire.

## Frame layout

Every transaction is **command word (32 bits)** + **payload (0-2048 bytes)**.

```c
// gSPI command word, transmitted big-endian on wire after halfword swap
uint32_t hdr =
      (write_bit << 31)         // 1 = host→chip, 0 = chip→host
    | (incr_bit  << 30)         // address auto-increment within block
    | (function  << 28)         // 2 bits — see below
    | ((address & 0x1FFFF) << 11)
    | (length & 0x7FF);         // 11 bits, byte count (max 2048)
```

| `function` | Name | Address space | Max payload |
|---|---|---|---|
| 0 | F0 / SPI bus control | gSPI register block | 64 B |
| 1 | F1 / Backplane | SOC peripheral bus (chipcommon, ARM core, RAM) | 64 B |
| 2 | F2 / Radio frame | DMA channel for 802.11 / Ethernet frames | 2048 B |
| 3 | (unused) | — | — |

### F0 register map (only what's load-bearing for emulation)

| Address | Name | Behaviour the driver expects |
|---|---|---|
| 0x00 | SPI_BUS_CTL | Driver writes `0x000204b3` early to set 32-bit mode + LE. Stub: store, echo back. |
| 0x04 | SPI_RESPONSE_DELAY | Driver writes `0x0004`. Stub: store. |
| 0x08 | SPI_STATUS_ENABLE | Stub: store. |
| 0x0C | SPI_RESET_BP | Resets backplane. Stub: zero our F1 address pointer. |
| 0x14 | **SPI_READ_TEST** | **Always returns `0xFEEDBEAD`** when chip is ready. The driver polls this until it matches before doing anything else. |
| 0x18 | SPI_WRITE_TEST | Driver writes a value, reads back at 0x14 cycle… stub: store + echo. |
| 0x20 | SPI_INTERRUPT | RW1C interrupt status. Bits include F2_F3_FIFO_RD_UNDERFLOW (0x0080), F2_PACKET_AVAILABLE (0x0040). |
| 0x24 | SPI_INTERRUPT_ENABLE | Mask. |
| 0x2C | SPI_BUS_CTL2 | High-speed enable. |
| 0x30 | SPI_FUNCTION_INT_MASK | Per-function IRQ mask. |
| 0x3C | SPI_F2_INFO | Bit 0 = F2 ready. **Driver waits for this** after firmware load. |

### F1 backplane

This is the big window. The driver writes a target address into three
"backplane address" registers (low 8 bits at 0x1000a, mid 8 at 0x1000b,
high 8 at 0x1000c) and then reads/writes a 32 KB window mapped into F1
address space. Effective target spans:

| Region | Base | Length | What's there |
|---|---|---|---|
| Chipcommon | 0x18000000 | 4 KB | Chip ID, GPIO control, capabilities |
| WLAN ARM CM3 core | 0x18003000 | 4 KB | The CPU core inside the chip — driver halts/runs it |
| SOC SRAM | 0x18004000 | 4 KB | Bank index/PDA registers |
| SDIO core | 0x18002000 | 4 KB | SHARED interrupt mailbox (driver reuses this in gSPI mode) |
| RAM (bulk) | 0x00000000 | 512 KB | Firmware lives here once loaded |

For an emulator we can:
- Service chipcommon read with a fixed chip-ID sequence (CYW43439 = 0xA9A6 in CHIPCOMMON_BASE+0).
- Pretend the WLAN core halt/reset bits work (just record them).
- **Discard firmware writes silently** — when driver writes 224 KB to address 0, we don't store it. No one reads it back.
- Service the "post-firmware probe" reads with the values the driver expects (e.g. magic at known offsets).

### F2 frame channel

Once the chip is "ready" the driver pushes/pulls Ethernet-style frames
through F2. Each frame is wrapped in a SDPCM header (Broadcom's data
plane protocol) with a small set of opcodes:

```c
struct sdpcm_header {
    uint16_t size;          // total bytes including header
    uint16_t size_complement;
    uint8_t  sequence;
    uint8_t  channel;       // 0=control IOCTL, 1=event, 2=data, 3=glom
    uint8_t  next_length;
    uint8_t  header_length;
    uint8_t  flow_ctl;
    uint8_t  credit;
    uint16_t reserved;
};
```

For Tier 2 emulation (full WiFi) we have to:
- Parse SDPCM channel 0 (IOCTLs — `WLC_SCAN`, `WLC_SET_SSID`, `WLC_GET_BSS_INFO`, etc.), respond with cooked replies.
- Wrap outgoing data (channel 2) into Ethernet frames and feed them to a userspace TCP/IP sink (e.g. `lwip` running in JS, or — easier — pass IP packets to a slirp library).
- Synthesise WLC_E_LINK / WLC_E_SET_SSID events on channel 1 to drive the driver's connection state machine.

For Tier 0 / Tier 1 (handshake stub) we only need to ack the first
~30 IOCTLs the driver sends during `cyw43_ll_bus_init()` →
`cyw43_ll_wifi_init()`.

## The handshake-up-to-WL_INIT sequence

This is the minimum the driver does between `power on` and "I have a
MAC address and the chip is alive". From `cyw43_ll.c::cyw43_ll_bus_init`,
abridged:

1. Pulse WL_REG_ON low/high (host drives GPIO 23).
2. Drive CS low, clock 32 zero bits (wakes the chip from SPI sleep).
3. Read F0:0x14 in a loop until it equals `0xFEEDBEAD`.
4. Write F0:0x18 = `0xAD4FEEDB` (test pattern), read F0:0x14 to confirm.
5. Write F0:0x00 = `0x000204b3` (32-bit, LE, no swap, high speed).
6. Set up backplane window via F1:0x1000a / 0x1000b / 0x1000c.
7. Disable WLAN core (write `SICF_CPUHALT` to AI core control via F1).
8. Disable SOCSRAM banks remap.
9. Stream firmware blob (224 KB) into F1 with auto-increment.
10. Stream NVRAM (small, ~2 KB) to high address.
11. Re-enable WLAN core (clear `SICF_CPUHALT`, set `SICF_CLOCK_EN`).
12. Poll F1::SDIO_CHIP_CLOCK_CSR for `SBSDIO_HT_AVAIL` bit (= chip CPU is running).
13. Configure SDIO interrupt masks via F1::SDIO_INT_*.
14. Configure F2 watermark and poll F0:0x3C for F2 ready bit.
15. Stream CLM (country/regulatory blob, ~7 KB) via IOCTL.
16. Send IOCTL `bsscfg:event_msgs` with a bitmask of events to receive.
17. Send IOCTL `cur_etheraddr` to read the MAC.
18. Driver returns success.

**Tier 0 stub** answers steps 1–14 with constants (the firmware/NVRAM
streams are ignored; we just track the auto-increment cursor so the
driver doesn't trip on length mismatches) and stops at step 14 by
permanently asserting "F2 ready". `cyw43_ll_bus_init()` returns. The
driver believes the chip is up. `network.WLAN(network.STA_IF)` does
not raise an exception — the user *thinks* WiFi is working.

`scan()` and `connect()` would then fail because we haven't
implemented IOCTLs (Tier 2). The graceful failure mode is to answer
`WLC_GET_BSS_INFO` with a synthetic "Velxio-Local" BSS and let the rest
hang in the way the driver does on a real chip with no AP nearby.

The next file lays out how to package this as code.
