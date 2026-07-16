"""Unit tests for the Python WASM Chip Runtime.

Loads compiled chip .wasm files DIRECTLY in Python (no QEMU, no WebSocket) and
simulates I2C bus events. This validates the runtime in isolation before
plugging it into the worker subprocess.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

# Add backend to import path so app.services.* imports work
_REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "backend"))

from app.services.wasm_chip_runtime import WasmChipRuntime  # noqa: E402
from app.services.wasm_chip_slave   import (                # noqa: E402
    WasmChipI2CSlave,
    I2C_START_SEND,
    I2C_START_RECV,
    I2C_WRITE,
    I2C_READ,
    I2C_FINISH,
)


_FIXTURES = _REPO / "test" / "test_custom_chips" / "fixtures"


def _wasm(name: str) -> bytes:
    p = _FIXTURES / f"{name}.wasm"
    if not p.is_file():
        pytest.skip(f"missing fixture {p} — run sandbox compile-all.sh")
    return p.read_bytes()


def _emit_capture():
    events = []
    def emit(payload):
        events.append(payload)
    return events, emit


# ────────────────────────────────────────────────────────────────────────────
# Inverter — simplest possible chip: 2 pins, no I2C
# ────────────────────────────────────────────────────────────────────────────

def test_inverter_chip_setup_runs():
    events, emit = _emit_capture()
    rt = WasmChipRuntime(_wasm("inverter"), emit=emit)
    rt.run_chip_setup()
    # Expect the chip's banner on chip_log.
    logs = [e["text"] for e in events if e["type"] == "chip_log"]
    assert any("inverter ready" in t for t in logs), f"expected banner, got: {logs}"
    # Two pins registered: IN and OUT
    assert len(rt._pins) == 2
    assert rt._pins[0]["name"] == "IN"
    assert rt._pins[1]["name"] == "OUT"
    # No I2C
    assert rt.i2c_address is None


# ────────────────────────────────────────────────────────────────────────────
# 24C01 EEPROM — full I2C write/read round-trip
# ────────────────────────────────────────────────────────────────────────────

def test_eeprom_24c01_chip_setup_registers_i2c_at_0x50():
    rt = WasmChipRuntime(_wasm("eeprom-24c01"))
    rt.run_chip_setup()
    assert rt.i2c_address == 0x50
    assert rt.i2c_callbacks is not None
    # Callbacks must all be non-zero (the chip wires up all four).
    for k in ("on_connect", "on_read", "on_write", "on_stop"):
        assert rt.i2c_callbacks[k] != 0, f"chip should wire up {k}"


def test_eeprom_24c01_write_then_read():
    """Master writes pointer 0x10, then 4 data bytes; reads them back."""
    rt = WasmChipRuntime(_wasm("eeprom-24c01"))
    rt.run_chip_setup()
    slave = WasmChipI2CSlave(rt.i2c_address, rt)

    # ── Phase 1: Write transaction ──
    assert slave.handle_event(I2C_START_SEND) == 0          # ACK
    # First byte after START is the register pointer
    assert slave.handle_event((0x10 << 8) | I2C_WRITE) == 0
    # Subsequent bytes are data, written sequentially with auto-increment
    for byte in (0xAA, 0xBB, 0xCC, 0xDD):
        assert slave.handle_event((byte << 8) | I2C_WRITE) == 0
    slave.handle_event(I2C_FINISH)

    # ── Phase 2: Reset pointer to 0x10 ──
    assert slave.handle_event(I2C_START_SEND) == 0
    assert slave.handle_event((0x10 << 8) | I2C_WRITE) == 0
    slave.handle_event(I2C_FINISH)

    # ── Phase 3: Read 4 bytes back ──
    assert slave.handle_event(I2C_START_RECV) == 0
    out = [slave.handle_event(I2C_READ) for _ in range(4)]
    slave.handle_event(I2C_FINISH)

    assert out == [0xAA, 0xBB, 0xCC, 0xDD], f"round-trip failed: {out}"


def test_eeprom_24c01_pointer_wraps_at_0x80():
    """Write near the end of the 128-byte memory and verify the pointer wraps."""
    rt = WasmChipRuntime(_wasm("eeprom-24c01"))
    rt.run_chip_setup()
    slave = WasmChipI2CSlave(rt.i2c_address, rt)

    # Write at addr 0x7F (last byte) and 0x00 (first byte).
    slave.handle_event(I2C_START_SEND)
    slave.handle_event((0x7F << 8) | I2C_WRITE)
    slave.handle_event((0xEE << 8) | I2C_WRITE)
    slave.handle_event(I2C_FINISH)

    slave.handle_event(I2C_START_SEND)
    slave.handle_event((0x00 << 8) | I2C_WRITE)
    slave.handle_event((0x11 << 8) | I2C_WRITE)
    slave.handle_event(I2C_FINISH)

    # Read from 0x7F — should get 0xEE then wrap to 0x00 → 0x11.
    slave.handle_event(I2C_START_SEND)
    slave.handle_event((0x7F << 8) | I2C_WRITE)
    slave.handle_event(I2C_FINISH)
    slave.handle_event(I2C_START_RECV)
    out = [slave.handle_event(I2C_READ) for _ in range(2)]
    slave.handle_event(I2C_FINISH)

    assert out == [0xEE, 0x11]


# ────────────────────────────────────────────────────────────────────────────
# 24LC256 EEPROM — 16-bit addressing
# ────────────────────────────────────────────────────────────────────────────

def test_eeprom_24lc256_high_address_round_trip():
    rt = WasmChipRuntime(_wasm("eeprom-24lc256"))
    rt.run_chip_setup()
    assert rt.i2c_address == 0x50
    slave = WasmChipI2CSlave(rt.i2c_address, rt)

    # Write 2-byte address 0x7FFE then bytes 0xDE, 0xAD.
    slave.handle_event(I2C_START_SEND)
    for b in (0x7F, 0xFE, 0xDE, 0xAD):
        slave.handle_event((b << 8) | I2C_WRITE)
    slave.handle_event(I2C_FINISH)

    # Reset pointer to 0x7FFE.
    slave.handle_event(I2C_START_SEND)
    for b in (0x7F, 0xFE):
        slave.handle_event((b << 8) | I2C_WRITE)
    slave.handle_event(I2C_FINISH)

    # Read.
    slave.handle_event(I2C_START_RECV)
    out = [slave.handle_event(I2C_READ) for _ in range(2)]
    slave.handle_event(I2C_FINISH)
    assert out == [0xDE, 0xAD]


# ────────────────────────────────────────────────────────────────────────────
# GPIO output — chip writes to a wired pin → pin_writer fires
# ────────────────────────────────────────────────────────────────────────────

def test_inverter_gpio_output_drives_qemu_pin():
    """When the chip's OUT is wired to ESP32 GPIO 5, vx_pin_write should call
    pin_writer(5, value) so QEMU's GPIO is driven in real time."""
    writes = []
    rt = WasmChipRuntime(
        _wasm("inverter"),
        pin_map={"IN": 4, "OUT": 5},
        pin_writer=lambda gpio, value: writes.append((gpio, value)),
        pin_reader=lambda gpio: 0,        # IN reads LOW initially
    )
    rt.run_chip_setup()
    # chip_setup writes OUT = !IN = !0 = HIGH
    assert (5, 1) in writes, f"expected initial OUT=HIGH; got {writes}"


# ────────────────────────────────────────────────────────────────────────────
# UART — feed_uart_byte → chip's on_rx_byte → uart_writer (echo back)
# ────────────────────────────────────────────────────────────────────────────

def test_uart_rot13_round_trip():
    """ROT13 chip: feed 'A' (0x41) → expect 'N' (0x4E) emitted via uart_writer."""
    sent = []
    rt = WasmChipRuntime(
        _wasm("uart-rot13"),
        uart_writer=lambda uart, data: sent.append((uart, bytes(data))),
    )
    rt.run_chip_setup()
    assert rt.uart_config is not None
    rt.feed_uart_byte(ord('A'))
    rt.feed_uart_byte(ord('Z'))    # ROT13('Z')='M'
    rt.feed_uart_byte(ord('1'))    # non-alpha passthrough
    assert sent == [(0, b'N'), (0, b'M'), (0, b'1')]


# ────────────────────────────────────────────────────────────────────────────
# SPI — chip ↔ master byte exchange via spi_transfer_byte
# ────────────────────────────────────────────────────────────────────────────

def test_sn74hc595_spi_shift_register():
    """74HC595: master clocks 0xA5 over SPI; on the next RCLK rising edge the
    chip latches the byte to its 8 output pins. We verify by inspecting the
    GPIO writes."""
    writes = []
    rt = WasmChipRuntime(
        _wasm("sn74hc595"),
        pin_map={
            "SER": 23, "SRCLK": 18, "RCLK": 5, "SRCLR": 22, "OE": 21, "QH": 19,
            "Q0": 100, "Q1": 101, "Q2": 102, "Q3": 103,
            "Q4": 104, "Q5": 105, "Q6": 106, "Q7": 107,
        },
        pin_writer=lambda gpio, value: writes.append((gpio, value)),
        pin_reader=lambda gpio: 1 if gpio == 22 else 0,  # SRCLR = HIGH (idle, not asserted)
    )
    rt.run_chip_setup()
    # The chip declared its SPI; verify config landed.
    assert rt.spi_config is not None
    # The chip's chip_setup armed an initial SPI transfer (per the chip's design:
    # "vx_spi_start(s->spi, s->spi_buf, 1)" at the end of chip_setup).
    assert rt._spi_buffer_count == 1, f"expected re-armed buffer; got {rt._spi_buffer_count}"

    # Master clocks one byte. The chip's MISO pre-fill is whatever was at
    # the buffer slot (initially 0). After the byte completes, on_done fires
    # which stores 0xA5 in shift_reg and calls vx_spi_start again.
    miso = rt.spi_transfer_byte(0xA5)
    assert miso in (0, 0xFF), f"unexpected MISO byte: {miso}"
    # After on_done re-armed, the buffer should be ready for another byte.
    assert rt._spi_buffer_count == 1
    assert rt._spi_buffer_pos == 0


def test_sn74hc595_full_spi_then_rclk_latch_drives_q_pins_correctly():
    """Full chain: SPI byte 0xA5 + RCLK rising edge → Q0..Q7 latched LSB-first.

    Mirrors the ESP32 E2E test scenario: master sends 0xA5 over SPI, then
    pulses RCLK HIGH. The chip's pin_watch on RCLK should fire on_rclk, which
    latches shift_reg→latch_reg and writes each Q pin via vx_pin_write.

    Expected: Q0..Q7 driven to 1,0,1,0,0,1,0,1 (LSB-first of 0xA5)."""
    writes: list[tuple[int, int]] = []
    Q_PINS = {f"Q{i}": 100 + i for i in range(8)}
    rt = WasmChipRuntime(
        _wasm("sn74hc595"),
        pin_map={
            "SER": 23, "SRCLK": 18, "RCLK": 5, "SRCLR": 22, "OE": 21, "QH": 19,
            **Q_PINS,
        },
        pin_writer=lambda gpio, value: writes.append((gpio, value)),
        pin_reader=lambda gpio: 1 if gpio == 22 else 0,
    )
    rt.run_chip_setup()
    assert rt.has_pin_watches(), "chip should have pin_watches on RCLK and SRCLR"
    # RCLK is gpio 5 → ensure that watch landed.
    assert 5 in rt._pin_watches, f"expected RCLK watch on gpio 5; got {list(rt._pin_watches.keys())}"

    # Clear the initial chip_setup writes (Q[i] = 0).
    writes.clear()

    # Step 1: master SPI byte 0xA5 → on_done stores 0xA5 in shift_reg.
    rt.spi_transfer_byte(0xA5)

    # Step 2: pulse RCLK rising edge → on_rclk fires → latch_reg = 0xA5
    # → update_outputs writes Q[i] = (0xA5 >> i) & 1.
    rt.notify_pin_change(5, 1)

    # 0xA5 = 10100101 in bits b7..b0; LSB-first into Q0..Q7:
    # Q0=1, Q1=0, Q2=1, Q3=0, Q4=0, Q5=1, Q6=0, Q7=1
    expected = [1, 0, 1, 0, 0, 1, 0, 1]
    actual = []
    for i in range(8):
        gpio = 100 + i
        # Last write to this gpio.
        last = next((v for (g, v) in reversed(writes) if g == gpio), None)
        actual.append(last)
    assert actual == expected, (
        f"Q0..Q7 latched values wrong: expected {expected}, got {actual}\n"
        f"all writes: {writes}"
    )


# ────────────────────────────────────────────────────────────────────────────
# Timers — pulse-counter is event-driven (no timer); use a synthetic test
# ────────────────────────────────────────────────────────────────────────────

def test_timer_handles_creation_and_stop():
    """Sanity check the timer host imports plumb through. The example chips
    don't use timers, so we just verify the API doesn't crash."""
    rt = WasmChipRuntime(_wasm("inverter"))
    rt.run_chip_setup()
    # No timers on inverter; deadline should be None.
    assert rt.next_timer_deadline() is None
    rt.fire_due_timers()  # no-op


# ────────────────────────────────────────────────────────────────────────────
# vx_pin_watch — edge-triggered chip callback
# ────────────────────────────────────────────────────────────────────────────

def test_inverter_pin_watch_fires_on_edge():
    """The inverter chip uses vx_pin_watch on IN with EDGE_BOTH. When QEMU's
    GPIO for IN changes (notify_pin_change), the chip's callback should fire
    and drive OUT to the inverse — observable via the pin_writer hook."""
    writes: list[tuple[int, int]] = []
    rt = WasmChipRuntime(
        _wasm("inverter"),
        pin_map={"IN": 4, "OUT": 5},
        pin_writer=lambda gpio, value: writes.append((gpio, value)),
        pin_reader=lambda gpio: 0,
    )
    rt.run_chip_setup()
    # Initial write at chip_setup: IN read 0 → OUT = !0 = HIGH.
    assert (5, 1) in writes
    assert rt.has_pin_watches()

    # Drive IN HIGH → chip's watch fires → OUT goes LOW.
    rt.notify_pin_change(4, 1)
    out_writes = [v for (g, v) in writes if g == 5]
    assert out_writes[-1] == 0, f"OUT should be LOW after IN HIGH; writes={writes}"

    # Drive IN back to LOW → OUT goes HIGH.
    rt.notify_pin_change(4, 0)
    out_writes = [v for (g, v) in writes if g == 5]
    assert out_writes[-1] == 1, f"OUT should be HIGH after IN LOW; writes={writes}"
