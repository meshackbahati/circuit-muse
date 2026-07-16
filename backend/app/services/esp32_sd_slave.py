"""esp32_sd_slave.py — synchronous SD-over-SPI card slave for the ESP32 QEMU
worker.

A faithful port of the browser microsd-card part
(frontend/src/simulation/parts/ProtocolParts.ts), which is validated end-to-end
against a real Arduino SD.h firmware. Same protocol, same three hard-won
details:

  - reply-FIRST: the MISO shifted out for a transfer was prepared by earlier
    bytes (full-duplex). transfer() returns the queued byte, THEN consumes the
    new MOSI. This gives the 1-byte Ncr command->response latency SD hosts read.
  - SDSC byte addressing: CMD17/18/24/25 args are byte offsets (block*512); the
    card presents SDSC (CMD58 CCS=0) and translates `arg >> 9` -> block.
  - the write data phase (token 0xFE/0xFC + 512 bytes + CRC) is captured.

The worker calls transfer(mosi) per byte while the card's CS is low and returns
the result as MISO. Bulk write-only transfers (no MISO) call feed() instead.
"""
from __future__ import annotations

from collections import deque
from typing import Deque, Dict, List, Optional

BLOCK = 512


class SdSpiSlave:
    def __init__(self, image: Optional[bytes] = None, card_bytes: int = 64 * 1024 * 1024):
        self._store: Dict[int, bytearray] = {}
        self._card_bytes = card_bytes
        self._c_size = (card_bytes // (512 * 1024)) - 1  # CSD v2 C_SIZE
        self._resp: Deque[int] = deque()
        self._cmd: List[int] = []
        self._expect_acmd = False
        # SD SPI state machine: the card is "idle" from reset (CMD0) until
        # ACMD41 completes. R1 for every command carries the idle bit, so a host
        # that issues CMD59/CMD8/CMD58 before ACMD41 (e.g. ESP-IDF's sdspi) sees
        # a consistent idle flag instead of a hardcoded 0x00.
        self._idle = True
        # CMD59 (CRC_ON_OFF): when the host enables CRC, it validates the CRC16
        # trailing every data block we send (CSD/CID/read), so we must compute
        # a real CRC. Arduino AVR SD.h leaves CRC off and ignores it.
        self._crc_enabled = False
        self._phase = "cmd"  # cmd | wait-token | recv-data | recv-crc
        self._data: List[int] = []
        self._crc_left = 0
        self._write_addr = 0
        self._multi_write = False
        self._multi_read = False
        self._read_addr = 0
        if image:
            self.load_image(image)

    # ── Backing store (sparse) ──────────────────────────────────────────────
    def load_image(self, image: bytes) -> None:
        for i in range((len(image) + BLOCK - 1) // BLOCK):
            chunk = image[i * BLOCK : (i + 1) * BLOCK]
            if any(chunk):  # skip all-zero blocks -> sparse
                blk = bytearray(BLOCK)
                blk[: len(chunk)] = chunk
                self._store[i] = blk

    def _read_block(self, idx: int) -> bytes:
        return bytes(self._store.get(idx, bytearray(BLOCK)))

    def _write_block(self, idx: int, data: List[int]) -> None:
        blk = bytearray(BLOCK)
        blk[: min(len(data), BLOCK)] = bytes(data[:BLOCK])
        self._store[idx] = blk

    # ── Response helpers ────────────────────────────────────────────────────
    @staticmethod
    def _crc16(data: bytes) -> int:
        """CRC-16-CCITT (poly 0x1021, init 0x0000) — the SD data-block CRC."""
        crc = 0
        for b in data:
            crc ^= b << 8
            for _ in range(8):
                crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
                crc &= 0xFFFF
        return crc

    def _data_crc(self, data: bytes) -> tuple:
        if self._crc_enabled:
            c = self._crc16(data)
            return ((c >> 8) & 0xFF, c & 0xFF)
        return (0xFF, 0xFF)

    def _r1(self) -> int:
        """R1 status byte — only the idle bit varies for our purposes."""
        return 0x01 if self._idle else 0x00

    def _push_data_block(self, data: bytes) -> None:
        self._resp.append(0xFE)  # start-block token
        self._resp.extend(data)
        self._resp.extend(self._data_crc(bytes(data)))

    def _push_short(self, payload: List[int]) -> None:
        self._resp.append(self._r1())
        self._resp.append(0xFE)
        self._resp.extend(payload)
        self._resp.extend(self._data_crc(bytes(payload)))

    def _build_csd(self) -> List[int]:
        return [
            0x40, 0x0E, 0x00, 0x32, 0x5B, 0x59, 0x00,
            (self._c_size >> 16) & 0x3F, (self._c_size >> 8) & 0xFF, self._c_size & 0xFF,
            0x7F, 0x80, 0x0A, 0x40, 0x00, 0x01,
        ]

    def _build_cid(self) -> List[int]:
        return [0x01, 0x56, 0x58, 0x56, 0x45, 0x4C, 0x58, 0x53,
                0x10, 0x00, 0x00, 0x00, 0x01, 0x01, 0x60, 0x01]

    def _process_cmd(self, raw: List[int]) -> None:
        cmd = raw[0] & 0x3F
        arg = ((raw[1] << 24) | (raw[2] << 16) | (raw[3] << 8) | raw[4]) & 0xFFFFFFFF
        is_acmd = self._expect_acmd
        self._expect_acmd = False

        if is_acmd:
            if cmd == 41:  # SD_SEND_OP_COND — report ready, leave idle state
                self._idle = False
                self._resp.append(0x00)
                return
            if cmd == 13:
                self._resp.extend((0x00, 0x00))
                return

        if cmd == 0:  # GO_IDLE_STATE — (re)enter idle
            self._idle = True
            self._resp.append(0x01)
        elif cmd == 8:  # SEND_IF_COND — R7 = R1 + echo-back
            self._resp.extend((self._r1(), 0x00, 0x00, 0x01, 0xAA))
        elif cmd == 9:
            self._push_short(self._build_csd())
        elif cmd == 10:
            self._push_short(self._build_cid())
        elif cmd == 12:
            self._multi_read = False
            self._resp.extend((0x00, 0x00, 0xFF))
        elif cmd == 13:
            self._resp.extend((self._r1(), 0x00))
        elif cmd == 16:  # SET_BLOCKLEN
            self._resp.append(self._r1())
        elif cmd == 17:  # READ_SINGLE (byte addr)
            self._resp.append(0x00)
            self._push_data_block(self._read_block(arg >> 9))
        elif cmd == 18:  # READ_MULTIPLE
            self._resp.append(0x00)
            self._read_addr = arg >> 9
            self._multi_read = True
            self._push_data_block(self._read_block(self._read_addr))
            self._read_addr += 1
        elif cmd == 24:  # WRITE_SINGLE
            self._resp.append(0x00)
            self._write_addr = arg >> 9
            self._multi_write = False
            self._phase = "wait-token"
        elif cmd == 25:  # WRITE_MULTIPLE
            self._resp.append(0x00)
            self._write_addr = arg >> 9
            self._multi_write = True
            self._phase = "wait-token"
        elif cmd == 55:  # APP_CMD
            self._resp.append(self._r1())
            self._expect_acmd = True
        elif cmd == 58:  # READ_OCR — powered, CCS=0 (SDSC)
            self._resp.extend((self._r1(), 0x80, 0xFF, 0x80, 0x00))
        elif cmd == 59:  # CRC_ON_OFF — bit0 of arg toggles data-block CRC checks
            self._crc_enabled = bool(arg & 0x1)
            self._resp.append(self._r1())
        else:
            self._resp.append(self._r1())

    # ── Per-byte full-duplex transfer ───────────────────────────────────────
    def transfer(self, mosi: int) -> int:
        """Reply-first: return the MISO prepared by earlier bytes, then consume
        this MOSI byte (which queues MISO for subsequent transfers)."""
        reply = self._resp.popleft() if self._resp else 0xFF

        mosi &= 0xFF
        if self._phase == "cmd":
            if not self._cmd and (mosi & 0xC0) == 0x40:
                self._cmd = [mosi]
            elif self._cmd:
                self._cmd.append(mosi)
                if len(self._cmd) == 6:
                    self._process_cmd(self._cmd)
                    self._cmd = []
            elif self._multi_read and not self._resp:
                self._push_data_block(self._read_block(self._read_addr))
                self._read_addr += 1
        elif self._phase == "wait-token":
            if mosi in (0xFE, 0xFC):
                self._phase = "recv-data"
                self._data = []
            elif mosi == 0xFD:
                self._multi_write = False
                self._phase = "cmd"
                self._resp.append(0x00)
        elif self._phase == "recv-data":
            self._data.append(mosi)
            if len(self._data) == BLOCK:
                self._phase = "recv-crc"
                self._crc_left = 2
        elif self._phase == "recv-crc":
            self._crc_left -= 1
            if self._crc_left == 0:
                self._write_block(self._write_addr, self._data)
                self._write_addr += 1
                self._resp.append(0x05)  # data accepted
                self._phase = "wait-token" if self._multi_write else "cmd"

        return reply

    def feed(self, mosi: int) -> None:
        """Consume a write-only byte (bulk path) — MISO discarded."""
        self.transfer(mosi)

    def to_image(self) -> bytes:
        """Serialise the (possibly firmware-modified) store back to bytes."""
        if not self._store:
            return b""
        top = max(self._store) + 1
        out = bytearray(top * BLOCK)
        for idx, blk in self._store.items():
            out[idx * BLOCK : idx * BLOCK + BLOCK] = blk
        return bytes(out)
