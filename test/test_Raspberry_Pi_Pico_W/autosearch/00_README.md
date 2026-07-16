# Pico W WiFi (CYW43439) emulation — autosearch dossier

This folder collects the research that backs **the question raised by the
user on 2026-04-28**:

> "Velxio emulates ESP32 WiFi but not Raspberry Pi Pico W WiFi. The
> WiFi chip is a CYW43439. Has anyone written an emulator for it? Look
> at `third-party/rp2040js`, find out what would be needed to complete
> WiFi emulation."

## TL;DR

| Question | Answer |
|---|---|
| Does upstream `rp2040js` emulate the CYW43439? | **No.** Open issue [#134](https://github.com/wokwi/rp2040js/issues/134) ("Is there a way to emulate cyw43 using nodejs?") sits unanswered since it was opened. There is no PR, no branch, no design draft. |
| Does Wokwi emulate Pico W WiFi today? | **Yes**, but the CYW43 model is **closed-source** and lives server-side together with the rest of the Wokwi network stack. Only the bare RP2040 core (`rp2040js`) is open. |
| Is there any community emulator? | **No.** Every CYW43 project we found is the *opposite direction* — host-side drivers (`georgerobotics/cyw43-driver`, `embassy-rs/cyw43`, `soypat/cyw43439`, `iosoft/picowi`) that talk to *real* silicon. None is an emulator of the chip. |
| Is the protocol documented well enough to build one? | **Mostly yes.** The gSPI bus is described in the Infineon datasheet and re-implemented in three open-source drivers. The 224 KB firmware blob is *not* — it is a closed binary loaded into the chip, but for emulation purposes we don't need to run it; we only need to **answer the host driver as if it had executed**. |
| Reasonable scope for Velxio? | **Yes, in tiers** (see [04_emulation_design.md](./04_emulation_design.md)). Tier 0 (handshake-only stub) is doable in days. Tier 2 (DHCP + TCP via slirp) is comparable in size to the existing ESP32 path. |

## What's in this folder

```
00_README.md                    ← this file
01_velxio_current_state.md      ← what Velxio actually does today on Pico W
02_rp2040js_inventory.md        ← what rp2040js exposes that we'd hook into
03_cyw43_bus_protocol.md        ← gSPI command word, registers, magic values
04_emulation_design.md          ← layered plan from stub → full WiFi
05_existing_implementations.md  ← every CYW43 codebase we found, classified
06_firmware_blob_question.md    ← can we ship the 224 KB blob? legal/practical
07_open_questions.md            ← decisions we cannot make from research alone
sources.md                      ← canonical URLs, dated 2026-04-28
```

The companion folder `../test_code/` contains runnable prototypes that
exercise these findings against the real `third-party/rp2040js`.
