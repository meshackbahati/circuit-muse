# Setup Status

> **This page is kept for backward compatibility with older links.**
> The full, up-to-date feature inventory lives in [roadmap.md](./roadmap.md).

## Current snapshot

| Area | Status |
|------|--------|
| Boards | 19 across 5 CPU architectures (AVR, RP2040, Xtensa, RISC-V, ARM) |
| Components | 152+ catalog parts across 11 categories |
| Digital simulation | Real CPU emulation on every board (avr8js, rp2040js, lcgamboa QEMU, upstream QEMU) |
| Analog simulation | ngspice WASM with NetlistBuilder + AVR/ESP32 bridges (toolbar toggle) |
| Custom chips | C-to-WASM SDK + 30+ example chips (Intel 4004/8080, Z80, 74HC595, EEPROM, …) |
| Languages | Arduino C++, ESP-IDF C, MicroPython, Python 3 (Pi) |
| Apps | Web (OSS + Pro), Tauri desktop |
| MCP server | stdio + SSE, 7 tools |
| Examples | 380+ across 7 collections |
| Persistence | `.vlx` portable JSON snapshot (no server-side state in OSS) |
| Deploy | Single-container Docker image (GHCR + Docker Hub), Docker Compose for build-from-source |

## See also

- [Roadmap](./roadmap.md) — Full feature list, in-progress and planned items
- [Architecture](./ARCHITECTURE.md) — System overview
- [Emulator Architecture](./emulator.md) — Per-CPU-backend details
- [Components Reference](./components.md) — Catalog by category
- [Desktop App](./desktop-app.md), [MCP Server](./MCP.md)
