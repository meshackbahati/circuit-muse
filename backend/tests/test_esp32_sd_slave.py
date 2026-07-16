"""Unit tests for the ESP32 SD-over-SPI slave (esp32_sd_slave.SdSpiSlave).

Mirrors the browser part's tests (protocol-parts.test.ts) — same protocol that
is validated end-to-end against real Arduino SD.h firmware in
frontend/src/__tests__/microsd-real-firmware.test.ts. Confirms the Python port
is faithful: reply-first 1-byte latency, SDSC byte addressing, write capture.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent.parent / "app" / "services" / "esp32_sd_slave.py"
_spec = importlib.util.spec_from_file_location("esp32_sd_slave", _here)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["esp32_sd_slave"] = _mod
_spec.loader.exec_module(_mod)
SdSpiSlave = _mod.SdSpiSlave


def xfer(s, data):
    return [s.transfer(b) for b in data]


def cmd(idx, arg=0):
    return [0x40 | idx, (arg >> 24) & 0xFF, (arg >> 16) & 0xFF, (arg >> 8) & 0xFF, arg & 0xFF, 0x95]


def FF(n):
    return [0xFF] * n


def at(block):
    return block * 512


def test_init_handshake():
    s = SdSpiSlave()
    # 1-byte Ncr latency: R1 on the first 0xFF clock after the 6 command bytes.
    r = xfer(s, cmd(0) + FF(1))
    assert r[6] == 0x01  # idle
    r = xfer(s, cmd(8, 0x1AA) + FF(5))
    assert r[6:11] == [0x01, 0x00, 0x00, 0x01, 0xAA]  # R7
    r = xfer(s, cmd(55) + FF(1))
    assert r[6] == 0x01
    r = xfer(s, cmd(41) + FF(1))
    assert r[6] == 0x00  # ACMD41 ready
    r = xfer(s, cmd(58) + FF(5))
    assert r[6:11] == [0x00, 0x80, 0xFF, 0x80, 0x00]  # OCR, SDSC (CCS=0)


def test_write_then_read_roundtrip():
    s = SdSpiSlave()
    data = [(i * 7 + 3) & 0xFF for i in range(512)]
    xfer(s, cmd(24, at(5)))
    r = xfer(s, [0xFF, 0xFE] + data + [0xFF, 0xFF, 0xFF])
    assert 0x05 in r  # data accepted
    r = xfer(s, cmd(17, at(5)) + FF(520))
    t = r.index(0xFE)
    assert r[t + 1 : t + 1 + 512] == data


def test_unwritten_block_is_zeros():
    s = SdSpiSlave()
    r = xfer(s, cmd(17, at(123)) + FF(520))
    t = r.index(0xFE)
    assert r[t + 1 : t + 1 + 512] == [0] * 512


def test_byte_addressing_translates_to_block():
    # Two different byte offsets that map to distinct blocks must not collide.
    s = SdSpiSlave()
    a = [0xAA] * 512
    b = [0xBB] * 512
    xfer(s, cmd(24, at(2)))
    xfer(s, [0xFF, 0xFE] + a + [0xFF, 0xFF, 0xFF])
    xfer(s, cmd(24, at(3)))
    xfer(s, [0xFF, 0xFE] + b + [0xFF, 0xFF, 0xFF])
    r2 = xfer(s, cmd(17, at(2)) + FF(520))
    r3 = xfer(s, cmd(17, at(3)) + FF(520))
    assert r2[r2.index(0xFE) + 1 : r2.index(0xFE) + 513] == a
    assert r3[r3.index(0xFE) + 1 : r3.index(0xFE) + 513] == b


def test_multi_block_write():
    s = SdSpiSlave()
    a = [(i + 1) & 0xFF for i in range(512)]
    b = [(i + 2) & 0xFF for i in range(512)]
    xfer(s, cmd(25, at(10)))
    xfer(s, [0xFC] + a + [0xFF, 0xFF])
    xfer(s, [0xFC] + b + [0xFF, 0xFF])
    xfer(s, [0xFD])  # stop token
    r10 = xfer(s, cmd(17, at(10)) + FF(520))
    r11 = xfer(s, cmd(17, at(11)) + FF(520))
    assert r10[r10.index(0xFE) + 1 : r10.index(0xFE) + 513] == a
    assert r11[r11.index(0xFE) + 1 : r11.index(0xFE) + 513] == b


def test_csd_reflects_capacity():
    s = SdSpiSlave()
    r = xfer(s, cmd(9) + FF(20))
    t = r.index(0xFE)
    csd = r[t + 1 : t + 1 + 16]
    assert len(csd) == 16
    assert csd[0] & 0xC0 == 0x40  # CSD structure v2


def _crc16(data):
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
            crc &= 0xFFFF
    return crc


def test_espidf_init_sequence_idle_bit():
    # Mirrors what ESP-IDF sdspi sends: CMD0, CMD59 (CRC on), CMD8, ACMD41,
    # CMD58. Every R1 before ACMD41 must carry the idle bit (0x01); the
    # hardcoded-0x00 bug stalled real ESP-IDF init right after CMD59.
    s = SdSpiSlave()
    assert xfer(s, cmd(0) + FF(1))[6] == 0x01            # idle
    assert xfer(s, [0x40 | 59, 0, 0, 0, 1, 0x83] + FF(1))[6] == 0x01  # CMD59 still idle
    assert xfer(s, cmd(8, 0x1AA) + FF(5))[6] == 0x01     # CMD8 R7, idle bit set
    assert xfer(s, cmd(55) + FF(1))[6] == 0x01
    assert xfer(s, cmd(41) + FF(1))[6] == 0x00           # ACMD41 -> ready, leaves idle
    assert xfer(s, cmd(58) + FF(5))[6] == 0x00           # CMD58 R1 now 0x00


def test_data_block_crc16_valid_when_enabled():
    # With CRC enabled (CMD59 arg=1), the 2 bytes trailing a read block must be
    # the real CRC16 of the block — ESP-IDF rejects the read otherwise.
    s = SdSpiSlave()
    payload = [(i * 13 + 7) & 0xFF for i in range(512)]
    xfer(s, cmd(24, at(8)))
    xfer(s, [0xFF, 0xFE] + payload + [0xFF, 0xFF, 0xFF])
    xfer(s, [0x40 | 59, 0, 0, 0, 1, 0x83] + FF(1))       # enable CRC
    r = xfer(s, cmd(17, at(8)) + FF(520))
    t = r.index(0xFE)
    block = r[t + 1 : t + 1 + 512]
    crc = (r[t + 513] << 8) | r[t + 514]
    assert block == payload
    assert crc == _crc16(bytes(block))


def test_data_block_crc_is_ff_when_disabled():
    # Default (no CMD59): CRC bytes are 0xFFFF — Arduino AVR SD.h ignores them.
    s = SdSpiSlave()
    r = xfer(s, cmd(17, at(0)) + FF(520))
    t = r.index(0xFE)
    assert r[t + 513] == 0xFF and r[t + 514] == 0xFF


def test_loads_a_prebuilt_image():
    block0 = bytes((i ^ 0x5A) & 0xFF for i in range(512))
    block1 = bytes((i + 200) & 0xFF for i in range(512))
    s = SdSpiSlave(block0 + block1)
    r0 = xfer(s, cmd(17, at(0)) + FF(520))
    r1 = xfer(s, cmd(17, at(1)) + FF(520))
    assert bytes(r0[r0.index(0xFE) + 1 : r0.index(0xFE) + 513]) == block0
    assert bytes(r1[r1.index(0xFE) + 1 : r1.index(0xFE) + 513]) == block1
