"""WasmChipI2CSlave — adapts a WasmChipRuntime to the QEMU I2C slave interface.

Implements the same `handle_event(event: int) -> int` contract that
MPU6050Slave / BMP280Slave / DS1307Slave use. Plug-compatible: register the
slave in `_i2c_slaves[addr]` and `_on_i2c_event` will route to it.

The picsimlab I2C protocol (ground truth in
docs/wiki/esp32-i2c-slave-simulation.md):
   op = event & 0xFF
   data = (event >> 8) & 0xFF        # only meaningful for WRITE

   0x00 START_RECV  — firmware called requestFrom
   0x01 START_SEND  — firmware called beginTransmission
   0x03 FINISH      — STOP or repeated-START
   0x04 NACK
   0x05 WRITE       — firmware sent `data` byte
   0x06 READ        — firmware reading; **return value IS the data byte**

Return-value convention:
   0  = ACK (success / device present)
   ≠0 = NACK (error)
   For READ: the byte to deliver to the firmware (not ACK/NACK).
"""
from __future__ import annotations

from app.services.wasm_chip_runtime import WasmChipRuntime


I2C_START_RECV = 0x00
I2C_START_SEND = 0x01
I2C_FINISH     = 0x03
I2C_NACK       = 0x04
I2C_WRITE      = 0x05
I2C_READ       = 0x06


class WasmChipI2CSlave:
    """Generic I2C slave whose protocol is implemented in a chip's WASM."""

    def __init__(self, addr: int, runtime: WasmChipRuntime):
        self.addr = addr
        self.runtime = runtime
        self._connect_pending = True   # fire on_connect once per transaction

    def handle_event(self, event: int) -> int:
        op   = event & 0xFF
        data = (event >> 8) & 0xFF

        if op == I2C_START_SEND:
            # Master starting a write transaction.
            self._connect(is_read=False)
            return 0  # ACK

        if op == I2C_START_RECV:
            self._connect(is_read=True)
            return 0  # ACK

        if op == I2C_WRITE:
            ack = self.runtime.call_i2c_callback("on_write", data)
            return 0 if ack else 1   # 0=ACK, 1=NACK

        if op == I2C_READ:
            # Return value is the byte itself, NOT an ACK/NACK marker.
            return self.runtime.call_i2c_callback("on_read") & 0xFF

        if op == I2C_FINISH:
            self.runtime.call_i2c_callback("on_stop")
            self._connect_pending = True
            return 0

        if op == I2C_NACK:
            self._connect_pending = True
            return 0

        # Unknown op — ACK silently to keep the bus alive.
        return 0

    def _connect(self, *, is_read: bool) -> None:
        if not self._connect_pending:
            return
        self.runtime.call_i2c_callback(
            "on_connect", self.addr, 1 if is_read else 0
        )
        self._connect_pending = False
