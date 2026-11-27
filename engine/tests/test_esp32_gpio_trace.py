"""ESP32 pin outputs in the QEMU fallback come from the MMIO write trace.

The Espressif QEMU build keeps no GPIO output state and has no GPIO chardev,
so without this LEDs never changed when libqemu-xtensa is absent.
"""
from __future__ import annotations

import asyncio

from app.services.esp_qemu_manager import (
    EspInstance,
    EspQemuManager,
    _GPIO_TRACE,
    apply_gpio_write,
)

LINE = "memory_region_ops_write cpu 1 mr 0x5649 addr 0x{addr:08x} value 0x{value:x} size 4 name '{name}'"


def test_set_clear_and_write_registers() -> None:
    state = apply_gpio_write(0, 0x08, 1 << 2)          # OUT_W1TS pin 2
    assert state == 1 << 2
    state = apply_gpio_write(state, 0x08, 1 << 5)      # set pin 5 too
    assert state == (1 << 2) | (1 << 5)
    state = apply_gpio_write(state, 0x0C, 1 << 2)      # OUT_W1TC pin 2
    assert state == 1 << 5
    state = apply_gpio_write(state, 0x04, 0)           # OUT write clears all low pins
    assert state == 0
    state = apply_gpio_write(state, 0x14, 1 << 1)      # OUT1_W1TS -> GPIO 33
    assert state == 1 << 33
    state = apply_gpio_write(state, 0x18, 1 << 1)      # OUT1_W1TC
    assert state == 0


def test_trace_regex_matches_only_gpio_block() -> None:
    assert _GPIO_TRACE.search(LINE.format(addr=0x3FF44008, value=4, name='esp32.gpio'))
    assert _GPIO_TRACE.search(LINE.format(addr=0x60004008, value=4, name='esp32s3.gpio'))
    assert not _GPIO_TRACE.search(LINE.format(addr=0x3FF40000, value=4, name='esp_soc.uart'))


def test_trace_lines_emit_pin_changes() -> None:
    events: list[tuple[str, dict]] = []

    async def callback(event: str, data: dict) -> None:
        events.append((event, data))

    async def run() -> None:
        manager = EspQemuManager()
        inst = EspInstance('c', 'esp32', callback)
        manager._handle_gpio_trace(inst, LINE.format(addr=0x3FF44008, value=4, name='esp32.gpio'))
        manager._handle_gpio_trace(inst, LINE.format(addr=0x3FF44008, value=4, name='esp32.gpio'))  # no change
        manager._handle_gpio_trace(inst, LINE.format(addr=0x3FF4400C, value=4, name='esp32.gpio'))
        await asyncio.sleep(0)

    asyncio.run(run())
    assert events == [
        ('gpio_change', {'pin': 2, 'state': 1}),
        ('gpio_change', {'pin': 2, 'state': 0}),
    ]


def test_fqbn_options_are_merged_once() -> None:
    from app.services.arduino_cli import ArduinoCLIService as A

    assert A._fqbn_with_options('esp32:esp32:esp32', {'FlashMode': 'dio', 'LoopCore': '0'}) == \
        'esp32:esp32:esp32:FlashMode=dio,LoopCore=0'
    assert A._fqbn_with_options('esp32:esp32:esp32:PSRAM=enabled', {'LoopCore': '0'}) == \
        'esp32:esp32:esp32:PSRAM=enabled,LoopCore=0'
    # A choice the user already made is kept.
    assert A._fqbn_with_options('esp32:esp32:esp32:LoopCore=1', {'LoopCore': '0'}) == \
        'esp32:esp32:esp32:LoopCore=1'


def test_loop_moves_to_core_zero_only_when_board_supports_it(monkeypatch) -> None:
    from app.services import esp32_lib_manager
    from app.services.arduino_cli import ArduinoCLIService

    monkeypatch.setattr(esp32_lib_manager.esp_lib_manager, 'is_available', lambda: False)
    service = ArduinoCLIService.__new__(ArduinoCLIService)
    service._cli_path = 'arduino-cli'
    service._board_options_cache = {
        'esp32:esp32:esp32': {'LoopCore', 'EventsCore', 'FlashMode'},
        'esp32:esp32:esp32c3': {'FlashMode'},
    }
    assert service._qemu_core_options('esp32:esp32:esp32') == {'LoopCore': '0', 'EventsCore': '0'}
    assert service._qemu_core_options('esp32:esp32:esp32c3') == {}
    assert service._qemu_core_options('esp32:esp32:esp32:LoopCore=1') == {}

    monkeypatch.setattr(esp32_lib_manager.esp_lib_manager, 'is_available', lambda: True)
    assert service._qemu_core_options('esp32:esp32:esp32') == {}
