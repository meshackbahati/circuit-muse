"""
Stm32LibManager — STM32 emulation via the lcgamboa libqemu-arm (.dll/.so).

Trimmed mirror of esp32_lib_manager.py. Each start_instance() launches a fresh
stm32_worker.py subprocess that loads libqemu-arm in its own address space and
drives an STM32 machine through the PICSimLab bridge. Background daemon threads
read the worker's stdout/stderr and dispatch events to the asyncio callback via
run_coroutine_threadsafe() — same plumbing as the ESP32 manager.

Public API kept intentionally close to EspLibManager so the simulation route
can treat STM32 like any other QEMU board:
    start_instance / stop_instance / load_firmware / set_pin_state / get_status

Activation: set QEMU_STM32_LIB to the library path, or drop
libqemu-arm.<ext> beside this module (or in VELXIO_QEMU_PATH).

Events emitted via callback(event_type, data):
  system        {event: 'booting'|'booted'|'crash'|'exited'}
  serial_output {data: str, uart: int}   — USART TX text (buffered)
  gpio_change   {pin: int, state: int}   — linear pin (port*16 + pin)
  gpio_dir      {pin: int, dir: int}      — 0=input 1=output
  error         {message: str}
"""
import asyncio
import dataclasses
import json
import logging
import os
import pathlib
import subprocess
import sys
import threading
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

_SERVICES_DIR = pathlib.Path(__file__).parent

if sys.platform == 'win32':
    _LIB_EXT = '.dll'
elif sys.platform == 'darwin':
    _LIB_EXT = '.dylib'
else:
    _LIB_EXT = '.so'

_LIB_ARM_NAME = f'libqemu-arm{_LIB_EXT}'
_DEFAULT_LIB_ARM = str(_SERVICES_DIR / _LIB_ARM_NAME)

_WORKER_SCRIPT = _SERVICES_DIR / 'stm32_worker.py'

EventCallback = Callable[[str, dict], Awaitable[None]]

# Board type -> lcgamboa machine name. Boards on SoCs whose GPIO is wired to
# the bridge today (F100 / F405) get full GPIO; F2 (netduino2) is serial-only
# until its GPIO is wired.
_MACHINE: dict[str, str] = {
    # Canonical BoardKind strings (sent verbatim by the frontend Stm32Bridge).
    'stm32-bluepill':        'stm32vldiscovery',   # F103 approximated by F100 SoC
    'stm32-blackpill':       'netduinoplus2',      # F411 approximated by F405 SoC (Cortex-M4)
    'stm32-bluepill-f103cb': 'stm32vldiscovery',   # F103CB approximated by F100 SoC
    'stm32-blackpill-f401':  'netduinoplus2',      # F401 approximated by F405 SoC
    'stm32-f4-discovery':    'netduinoplus2',      # F407 approximated by F405 SoC
    'stm32-olimex-h405':     'olimex-stm32-h405',  # F405 (native machine)
    'stm32-netduino-plus2':  'netduinoplus2',      # F405 (native machine)
    'stm32-netduino2':       'netduino2',          # F205 (serial-only until GPIO wired)
    # Legacy / alias keys (kept so older saved projects still resolve).
    'stm32-vldiscovery':     'stm32vldiscovery',
    'stm32f4-discovery':     'netduinoplus2',
    'netduinoplus2':         'netduinoplus2',
    'olimex-stm32-h405':     'olimex-stm32-h405',
    'netduino2':             'netduino2',
}


def _resolve_lib(env_var: str, lib_name: str, default_path: str) -> str:
    """Same three-step resolution as the ESP32 manager: env var, then
    VELXIO_QEMU_PATH directory, then beside this module."""
    direct = os.environ.get(env_var, '')
    if direct and os.path.isfile(direct):
        return direct
    qemu_dir = os.environ.get('VELXIO_QEMU_PATH', '')
    if qemu_dir:
        candidate = os.path.join(qemu_dir, lib_name)
        if os.path.isfile(candidate):
            return candidate
    if os.path.isfile(default_path):
        return default_path
    return ''


def lib_arm_path() -> str:
    """Current resolved path to libqemu-arm.<ext>, or '' if missing."""
    return _resolve_lib('QEMU_STM32_LIB', _LIB_ARM_NAME, _DEFAULT_LIB_ARM)


class _UartBuffer:
    """Accumulate bytes per UART channel, flush on newline or size limit."""

    def __init__(self, uart_id: int, flush_size: int = 256):
        self.uart_id = uart_id
        self.flush_size = flush_size
        self._buf = bytearray()
        self._lock = threading.Lock()

    def feed(self, byte_val: int) -> str | None:
        with self._lock:
            self._buf.append(byte_val)
            if byte_val in (ord('\n'), ord('\r')) or len(self._buf) >= self.flush_size:
                text = self._buf.decode('utf-8', errors='replace')
                self._buf.clear()
                return text
        return None

    def flush(self) -> str | None:
        with self._lock:
            if self._buf:
                text = self._buf.decode('utf-8', errors='replace')
                self._buf.clear()
                return text
        return None


@dataclasses.dataclass
class _WorkerInstance:
    process:    subprocess.Popen
    stdin_lock: threading.Lock
    callback:   EventCallback
    board_type: str
    uart_bufs:  dict[int, _UartBuffer]
    threads:    list[threading.Thread]
    loop:       asyncio.AbstractEventLoop
    sensors:    list = dataclasses.field(default_factory=list)
    running:    bool = True


class Stm32LibManager:
    """Manages STM32 emulation; one worker subprocess per client_id."""

    def __init__(self):
        self._instances: dict[str, _WorkerInstance] = {}
        self._instances_lock = threading.Lock()

    @staticmethod
    def is_available() -> bool:
        return bool(lib_arm_path()) and _WORKER_SCRIPT.exists()

    def get_instance(self, client_id: str) -> _WorkerInstance | None:
        with self._instances_lock:
            return self._instances.get(client_id)

    async def start_instance(
        self,
        client_id:    str,
        board_type:   str,
        callback:     EventCallback,
        firmware_b64: str | None = None,
        sensors:      list | None = None,
    ) -> None:
        if client_id in self._instances:
            logger.info('start_instance: %s already running — stopping first', client_id)
            await self.stop_instance(client_id)

        if not firmware_b64:
            logger.info('start_instance %s: no firmware — skipping worker launch', client_id)
            return

        machine  = _MACHINE.get(board_type, 'stm32vldiscovery')
        lib_path = lib_arm_path()
        if not lib_path:
            await callback('error', {'message': 'libqemu-arm not found (set QEMU_STM32_LIB)'})
            return

        config = json.dumps({
            'lib_path':     lib_path,
            'firmware_b64': firmware_b64,
            'machine':      machine,
            'sensors':      sensors or [],
        })

        logger.info('Launching stm32_worker for %s (machine=%s)', client_id, machine)
        try:
            await callback('system', {'event': 'booting'})
        except Exception as exc:
            logger.warning('start_instance %s: booting event failed: %s', client_id, exc)

        try:
            proc = subprocess.Popen(
                [sys.executable, str(_WORKER_SCRIPT)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except Exception as exc:
            logger.error('Failed to launch stm32_worker for %s: %r', client_id, exc)
            await callback('error', {'message': f'Worker launch failed: {exc}'})
            return

        try:
            assert proc.stdin is not None
            proc.stdin.write((config + '\n').encode())
            proc.stdin.flush()
        except Exception as exc:
            logger.error('Failed to write config to stm32_worker %s: %r', client_id, exc)
            proc.kill()
            return

        loop = asyncio.get_running_loop()
        inst = _WorkerInstance(
            process    = proc,
            stdin_lock = threading.Lock(),
            callback   = callback,
            board_type = board_type,
            uart_bufs  = {0: _UartBuffer(0), 1: _UartBuffer(1), 2: _UartBuffer(2)},
            threads    = [],
            loop       = loop,
            sensors    = list(sensors or []),
        )
        with self._instances_lock:
            self._instances[client_id] = inst

        t_out = threading.Thread(target=self._thread_read_stdout,
                                 args=(inst, client_id), daemon=True,
                                 name=f'stm32-stdout-{client_id[:8]}')
        t_err = threading.Thread(target=self._thread_read_stderr,
                                 args=(inst, client_id), daemon=True,
                                 name=f'stm32-stderr-{client_id[:8]}')
        inst.threads = [t_out, t_err]
        t_out.start()
        t_err.start()

    async def stop_instance(self, client_id: str) -> None:
        with self._instances_lock:
            inst = self._instances.pop(client_id, None)
        if not inst:
            return
        inst.running = False

        for buf in inst.uart_bufs.values():
            text = buf.flush()
            if text:
                try:
                    await inst.callback('serial_output', {'data': text, 'uart': buf.uart_id})
                except Exception:
                    pass

        self._write_cmd(inst, {'cmd': 'stop'})

        def _wait_and_kill():
            try:
                inst.process.wait(timeout=6.0)
            except subprocess.TimeoutExpired:
                inst.process.kill()
                inst.process.wait()
            except Exception:
                pass

        await asyncio.to_thread(_wait_and_kill)
        logger.info('Stm32 WorkerInstance %s shut down', client_id)

    def load_firmware(self, client_id: str, firmware_b64: str) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if not inst:
            logger.warning('load_firmware: no instance for %s', client_id)
            return
        board_type = inst.board_type
        callback   = inst.callback
        sensors    = list(inst.sensors)

        async def _restart() -> None:
            await self.stop_instance(client_id)
            await asyncio.sleep(0.1)
            await self.start_instance(client_id, board_type, callback, firmware_b64, sensors)

        asyncio.ensure_future(_restart())

    # ── Generic sensor protocol offloading (I2C/SPI device models) ─────────────

    def sensor_attach(self, client_id: str, sensor_type: str, pin: int,
                      properties: dict) -> None:
        """Register an I2C/SPI device on the bus — the worker builds the slave."""
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'cmd': 'sensor_attach', 'sensor_type': sensor_type,
                'pin': pin, **{k: v for k, v in properties.items()
                               if k not in ('sensor_type', 'pin')},
            })

    def sensor_update(self, client_id: str, pin: int, properties: dict) -> None:
        """Update a sensor's live values (temperature, pressure, accel…)."""
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'cmd': 'sensor_update', 'pin': pin,
                **{k: v for k, v in properties.items() if k != 'pin'},
            })

    def sensor_detach(self, client_id: str, pin: int) -> None:
        """Remove a device from the bus."""
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {'cmd': 'sensor_detach', 'pin': pin})

    def set_pin_state(self, client_id: str, pin: int | str, state_val: int) -> None:
        """Drive a GPIO input pin (linear pin number, port*16 + pin)."""
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {'cmd': 'set_pin', 'pin': int(pin), 'value': state_val})

    async def send_serial_bytes(self, client_id: str, data: bytes, uart_id: int = 0) -> None:
        """Feed bytes into an STM32 USART RX (cross-board UART from a peer board).

        NOTE: the worker forwards this to qemu_picsimlab_uart_receive, which is
        not yet implemented for the arm target, so today this is a no-op at the
        guest level. STM32-as-sender (gpio_change / serial_output out) works."""
        import base64 as _b64
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'cmd': 'uart_send', 'uart': uart_id,
                'data': _b64.b64encode(data).decode(),
            })

    def get_status(self, client_id: str) -> dict:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if not inst:
            return {'running': False}
        return {'running': True, 'alive': inst.process.returncode is None,
                'board': inst.board_type}

    # ── Internal ──────────────────────────────────────────────────────────────

    def _write_cmd(self, inst: _WorkerInstance, cmd: dict) -> None:
        try:
            with inst.stdin_lock:
                assert inst.process.stdin is not None
                inst.process.stdin.write((json.dumps(cmd) + '\n').encode())
                inst.process.stdin.flush()
        except Exception as exc:
            logger.debug('_write_cmd failed: %s', exc)

    def _thread_read_stdout(self, inst: _WorkerInstance, client_id: str) -> None:
        try:
            assert inst.process.stdout is not None
            for raw in inst.process.stdout:
                raw = raw.strip()
                if not raw:
                    continue
                idx = raw.find(b'{"type":')
                if idx > 0:
                    raw = raw[idx:]
                elif idx < 0:
                    continue
                try:
                    event = json.loads(raw)
                except Exception:
                    continue

                etype = event.pop('type', '')
                if etype == 'uart_tx':
                    uart_id  = event.get('uart', 0)
                    byte_val = event.get('byte', 0)
                    buf = inst.uart_bufs.get(uart_id)
                    if buf:
                        text = buf.feed(byte_val)
                        if text:
                            self._dispatch(inst, 'serial_output',
                                           {'data': text, 'uart': uart_id})
                elif etype:
                    self._dispatch(inst, etype, event)
        except Exception as exc:
            if inst.running:
                logger.debug('[%s] _thread_read_stdout ended: %s', client_id, exc)
        finally:
            rc = inst.process.returncode
            if rc is None:
                inst.process.poll()
                rc = inst.process.returncode
            if inst.running and rc is not None:
                logger.warning('[%s] stm32 worker exited (code %s)', client_id, rc)
                self._dispatch(inst, 'system',
                               {'event': 'crash', 'reason': 'worker_exit', 'code': rc})

    def _thread_read_stderr(self, inst: _WorkerInstance, client_id: str) -> None:
        try:
            assert inst.process.stderr is not None
            for line in inst.process.stderr:
                logger.info('[stm32-worker:%s] %s', client_id,
                            line.decode(errors='replace').rstrip())
        except Exception:
            pass

    def _dispatch(self, inst: _WorkerInstance, etype: str, data: dict) -> None:
        try:
            coro = inst.callback(etype, data)
            asyncio.run_coroutine_threadsafe(coro, inst.loop)  # type: ignore[arg-type]
        except Exception as exc:
            logger.debug('_dispatch %s failed: %s', etype, exc)


stm32_lib_manager = Stm32LibManager()
