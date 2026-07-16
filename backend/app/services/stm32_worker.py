#!/usr/bin/env python3
"""
stm32_worker.py — Standalone STM32 QEMU subprocess worker.

Loads libqemu-arm in its own process (same model as esp32_worker.py) and drives
an STM32 machine from the lcgamboa fork through the PICSimLab bridge
(hw/arm/stm32_picsimlab.c). Supports GPIO + UART TX + I2C + SPI. The I2C/SPI
device models (sensors + displays) are reused verbatim from the ESP32 worker's
slave modules (esp32_i2c_slaves.py, esp32_spi_slaves.py).

Excluded (ESP32-specific): WiFi, RMT/WS2812, LEDC, GPIO matrix, camera, WASM
custom chips, DHT22/HC-SR04 sync handlers.

Pin numbering is LINEAR 0-based: global_pin = port_index*16 + pin.

stdin  line 1 : JSON config {"lib_path","firmware_b64","machine","sensors"}
stdin  line 2+: JSON commands (set_pin, uart_send, sensor_attach/update/detach,
                set_i2c_response, set_spi_response, stop)
stdout        : JSON event lines (system, gpio_change, gpio_dir, uart_tx,
                i2c_trace, spi_batch, spi_event, epaper_update, error)
stderr        : debug logs
"""
import base64
import ctypes
import json
import os
import sys
import tempfile
import threading

# ── I2C slaves (reused from the ESP32 worker; generic register machines) ──────
try:
    from app.services.esp32_i2c_slaves import (
        MPU6050Slave as _MPU6050Slave, BMP280Slave as _BMP280Slave,
        DS1307Slave as _DS1307Slave, DS3231Slave as _DS3231Slave,
        I2CWriteSink as _I2CWriteSink, ProxySlave as _ProxySlave,
    )
except ImportError:
    import importlib.util as _ilu, pathlib as _pl, sys as _sys
    _spec = _ilu.spec_from_file_location(
        'esp32_i2c_slaves', _pl.Path(__file__).parent / 'esp32_i2c_slaves.py')
    _mod = _ilu.module_from_spec(_spec)            # type: ignore[arg-type]
    _sys.modules['esp32_i2c_slaves'] = _mod
    _spec.loader.exec_module(_mod)                 # type: ignore[union-attr]
    _MPU6050Slave = _mod.MPU6050Slave; _BMP280Slave = _mod.BMP280Slave
    _DS1307Slave = _mod.DS1307Slave; _DS3231Slave = _mod.DS3231Slave
    _I2CWriteSink = _mod.I2CWriteSink; _ProxySlave = _mod.ProxySlave

# ── SPI slaves (ePaper) ───────────────────────────────────────────────────────
try:
    from app.services.esp32_spi_slaves import (
        Ssd168xEpaperSlave as _Ssd168xEpaperSlave,
        Uc8159cEpaperSlave as _Uc8159cEpaperSlave,
    )
except ImportError:
    import importlib.util as _ilu, pathlib as _pl, sys as _sys
    _spec = _ilu.spec_from_file_location(
        'esp32_spi_slaves', _pl.Path(__file__).parent / 'esp32_spi_slaves.py')
    _mod = _ilu.module_from_spec(_spec)            # type: ignore[arg-type]
    _sys.modules['esp32_spi_slaves'] = _mod
    _spec.loader.exec_module(_mod)                 # type: ignore[union-attr]
    _Ssd168xEpaperSlave = _mod.Ssd168xEpaperSlave
    _Uc8159cEpaperSlave = _mod.Uc8159cEpaperSlave

_stdout_lock = threading.Lock()


def _emit(obj: dict) -> None:
    with _stdout_lock:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


def _log(msg: str) -> None:
    sys.stderr.write(f'[stm32_worker] {msg}\n')
    sys.stderr.flush()


_WRITE_PIN = ctypes.CFUNCTYPE(None,           ctypes.c_int,   ctypes.c_int)
_DIR_PIN   = ctypes.CFUNCTYPE(None,           ctypes.c_int,   ctypes.c_int)
_I2C_EVENT = ctypes.CFUNCTYPE(ctypes.c_int,   ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16)
_SPI_EVENT = ctypes.CFUNCTYPE(ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint16)
_UART_TX   = ctypes.CFUNCTYPE(None,           ctypes.c_uint8, ctypes.c_uint8)
_RMT_EVENT = ctypes.CFUNCTYPE(None,           ctypes.c_uint8, ctypes.c_uint32, ctypes.c_uint32)
_GPIO_MATRIX_CB = ctypes.CFUNCTYPE(None,       ctypes.c_int,   ctypes.c_int)


class _CallbacksT(ctypes.Structure):
    _fields_ = [
        ('picsimlab_write_pin',      _WRITE_PIN),
        ('picsimlab_dir_pin',        _DIR_PIN),
        ('picsimlab_i2c_event',      _I2C_EVENT),
        ('picsimlab_spi_event',      _SPI_EVENT),
        ('picsimlab_uart_tx_event',  _UART_TX),
        ('pinmap',                   ctypes.c_void_p),
        ('picsimlab_rmt_event',      _RMT_EVENT),
        ('picsimlab_gpio_matrix_cb', _GPIO_MATRIX_CB),
    ]


# I2C op decode (matches QEMU enum i2c_event + picsimlab_i2c.c encoding).
_I2C_OP = {0x00: 'START_RECV', 0x01: 'START_SEND', 0x03: 'FINISH',
           0x04: 'NACK', 0x05: 'WRITE', 0x06: 'READ'}


def main() -> None:
    raw_cfg = sys.stdin.readline()
    if not raw_cfg.strip():
        os._exit(1)
    cfg = json.loads(raw_cfg)
    lib_path        = cfg['lib_path']
    firmware_b64    = cfg['firmware_b64']
    machine         = cfg.get('machine', 'stm32vldiscovery')
    initial_sensors = cfg.get('sensors', [])

    _MINGW64_BIN = r'C:\msys64\mingw64\bin'
    if os.name == 'nt' and os.path.isdir(_MINGW64_BIN):
        os.add_dll_directory(_MINGW64_BIN)
    try:
        lib = ctypes.CDLL(lib_path)
    except Exception as exc:
        _emit({'type': 'error', 'message': f'Cannot load library: {exc}'})
        os._exit(1)

    lib.qemu_picsimlab_set_pin.restype = None
    lib.qemu_picsimlab_set_pin.argtypes = [ctypes.c_int, ctypes.c_int]
    try:
        _shutdown_request = lib.qemu_system_shutdown_request
        _shutdown_request.restype = None
        _shutdown_request.argtypes = [ctypes.c_int]
    except AttributeError:
        _shutdown_request = None

    try:
        fw_bytes = base64.b64decode(firmware_b64)
        tmp = tempfile.NamedTemporaryFile(suffix='.elf', delete=False)
        tmp.write(fw_bytes)
        tmp.close()
        firmware_path = tmp.name
    except Exception as exc:
        _emit({'type': 'error', 'message': f'Firmware decode error: {exc}'})
        os._exit(1)

    args_list = [b'qemu', b'-M', machine.encode(), b'-nographic',
                 b'-kernel', firmware_path.encode()]
    argc = len(args_list)
    argv = (ctypes.c_char_p * argc)(*args_list)

    _stopped   = threading.Event()
    _init_done = threading.Event()

    # ── Shared peripheral state ───────────────────────────────────────────────
    _i2c_slaves: dict = {}             # 7-bit addr → slave instance
    _i2c_responses: dict = {}          # addr → response byte (no-slave fallback)
    _spi_response = [0xFF]
    _spi_byte_buf = bytearray()
    _spi_buf_lock = threading.Lock()
    _SPI_BATCH_FLUSH_AT = 4096
    _SPI_BATCH_PERIOD_S = 0.05
    _epaper_slaves: dict = {}
    _epaper_state: dict = {}
    _pin_state: dict = {}
    _sensors: dict = {}
    _sensors_lock = threading.Lock()

    def _register_sensor(s: dict) -> None:
        """Instantiate the right I2C/SPI slave for a sensor descriptor."""
        stype = s.get('sensor_type', '')
        if stype == 'mpu6050':
            addr = int(s.get('addr', 0x68)); _i2c_slaves[addr] = _MPU6050Slave(addr)
        elif stype == 'bmp280':
            addr = int(s.get('addr', 0x76)); sl = _BMP280Slave(addr)
            if 'temperature' in s: sl.update(float(s['temperature']), sl._press_hpa)
            if 'pressure' in s: sl.update(sl._temp_c, float(s['pressure']))
            _i2c_slaves[addr] = sl
        elif stype in ('ds1307', 'ds3231'):
            addr = int(s.get('addr', 0x68))
            _i2c_slaves[addr] = _DS3231Slave() if stype == 'ds3231' else _DS1307Slave()
        elif stype in ('ssd1306', 'pcf8574'):
            addr = int(s.get('addr', 0x3C if stype == 'ssd1306' else 0x27))
            _i2c_slaves[addr] = _I2CWriteSink(addr, _emit)
        elif stype == 'epaper-ssd168x':
            comp = str(s.get('component_id', 'epaper'))
            w = int(s.get('width', 200)); h = int(s.get('height', 200))
            refresh = int(s.get('refresh_ms', 50))
            fam = str(s.get('controller_family', 'ssd168x'))

            def _on_flush(frame, _c=comp, _w=w, _h=h, _r=refresh):
                try:
                    b64 = base64.b64encode(frame.pixels).decode('ascii')
                except Exception:
                    return
                _emit({'type': 'epaper_update', 'data': {
                    'component_id': _c, 'width': _w, 'height': _h,
                    'frame_b64': b64, 'refresh_ms': _r}})
            slave = (_Uc8159cEpaperSlave if fam == 'uc8159c' else _Ssd168xEpaperSlave)(
                component_id=comp, width=w, height=h, on_flush=_on_flush)
            _epaper_slaves[comp] = slave
            _epaper_state[comp] = {
                'slave': slave, 'dc_pin': int(s.get('dc_pin', -1)),
                'cs_pin': int(s.get('cs_pin', -1)), 'rst_pin': int(s.get('rst_pin', -1)),
                'cs_low': False, 'dc_high': False}

    # ── Callbacks (QEMU thread) ───────────────────────────────────────────────
    def _on_pin_change(pin, value):
        if _stopped.is_set():
            return
        pin = int(pin); value &= 1
        _pin_state[pin] = value
        _emit({'type': 'gpio_change', 'pin': pin, 'state': value})
        # ePaper DC/CS/RST tracking (CS active-low, RST clears on low).
        for st in _epaper_state.values():
            if pin == st['dc_pin']:
                st['dc_high'] = bool(value)
            elif pin == st['cs_pin']:
                st['cs_low'] = (value == 0)
            elif pin == st['rst_pin'] and value == 0:
                st['slave'].reset()

    def _on_dir_change(pin, direction):
        if _stopped.is_set() or pin < 0:
            return
        _emit({'type': 'gpio_dir', 'pin': int(pin), 'dir': int(direction)})

    def _on_uart_tx(uart_id, byte_val):
        if _stopped.is_set():
            return
        _emit({'type': 'uart_tx', 'uart': int(uart_id), 'byte': int(byte_val)})

    def _on_i2c_event(bus_id, addr, event):
        """Synchronous — dispatch to the slave at `addr`; return read byte."""
        slave = _i2c_slaves.get(addr)
        op = event & 0xFF
        if slave is not None:
            result = slave.handle_event(event)
            if not _stopped.is_set() and type(slave).__name__ != 'I2CWriteSink':
                _emit({'type': 'i2c_trace', 'bus': int(bus_id), 'addr': int(addr),
                       'op': _I2C_OP.get(op, hex(op)), 'result': result})
            return result
        resp = _i2c_responses.get(addr, 0)
        # NACK an unclaimed address on START so probes fail cleanly.
        if op in (0x00, 0x01) and resp == 0 and addr not in _i2c_responses:
            return 1
        return resp

    def _flush_spi_batch_locked():
        if _spi_byte_buf and not _stopped.is_set():
            b64 = base64.b64encode(bytes(_spi_byte_buf)).decode('ascii')
            _emit({'type': 'spi_batch', 'b64': b64})
            _spi_byte_buf.clear()

    def _on_spi_event(bus_id, event):
        op = event & 0xFF
        mosi = (event >> 8) & 0xFF
        # ePaper panels: feed every byte to the active (CS low) slave.
        if _epaper_state and op == 0x00:
            for st in _epaper_state.values():
                if st['cs_low']:
                    try:
                        st['slave'].feed(mosi, st['dc_high'])
                    except Exception as e:
                        _log(f'[epaper] {e!r}')
            return 0xFF
        resp = _spi_response[0]
        if _stopped.is_set():
            return resp
        if op == 0x00:
            with _spi_buf_lock:
                _spi_byte_buf.append(mosi)
                if len(_spi_byte_buf) >= _SPI_BATCH_FLUSH_AT:
                    _flush_spi_batch_locked()
        else:
            with _spi_buf_lock:
                _flush_spi_batch_locked()
            _emit({'type': 'spi_event', 'bus': int(bus_id), 'event': int(event)})
        return resp

    def _on_rmt_event(channel, config0, value):
        return

    def _on_gpio_matrix(gpio, signal_id):
        return

    _PINMAP = (ctypes.c_int16 * 1)(0)
    _cbs_ref = _CallbacksT(
        picsimlab_write_pin      = _WRITE_PIN(_on_pin_change),
        picsimlab_dir_pin        = _DIR_PIN(_on_dir_change),
        picsimlab_i2c_event      = _I2C_EVENT(_on_i2c_event),
        picsimlab_spi_event      = _SPI_EVENT(_on_spi_event),
        picsimlab_uart_tx_event  = _UART_TX(_on_uart_tx),
        pinmap                   = ctypes.cast(_PINMAP, ctypes.c_void_p).value,
        picsimlab_rmt_event      = _RMT_EVENT(_on_rmt_event),
        picsimlab_gpio_matrix_cb = _GPIO_MATRIX_CB(_on_gpio_matrix),
    )
    lib.qemu_picsimlab_register_callbacks(ctypes.byref(_cbs_ref))

    # Pre-register sensors from the start config. Keep a record keyed by pin so
    # later sensor_update commands (from the live SensorControlPanel) can find
    # the device and merge new values in.
    for s in initial_sensors:
        try:
            _register_sensor(s)
            _sensors[int(s.get('pin', 0))] = dict(s)
        except Exception as e:
            _log(f'sensor init failed: {e!r}')
    _log(f'i2c slaves: {list(_i2c_slaves.keys())}')

    def _qemu_thread():
        try:
            lib.qemu_init(argc, argv, None)
        except Exception as exc:
            _emit({'type': 'error', 'message': f'qemu_init failed: {exc}'})
        finally:
            _init_done.set()
        lib.qemu_main_loop()

    import io as _io
    _orig_stdin_fd = os.dup(0)
    _nul = os.open(os.devnull, os.O_RDONLY); os.dup2(_nul, 0); os.close(_nul)
    _orig_stdout_fd = os.dup(1)
    _nul_w = os.open(os.devnull, os.O_WRONLY); os.dup2(_nul_w, 1); os.close(_nul_w)
    sys.stdout = _io.TextIOWrapper(
        _io.FileIO(_orig_stdout_fd, mode='w', closefd=True),
        line_buffering=True, write_through=True)

    qemu_t = threading.Thread(target=_qemu_thread, daemon=True, name=f'qemu-{machine}')
    qemu_t.start()
    if not _init_done.wait(timeout=30.0):
        _emit({'type': 'error', 'message': 'qemu_init timed out after 30 s'})
        os._exit(1)

    # SPI batch flush thread.
    def _spi_flush_loop():
        while not _stopped.is_set():
            _stopped.wait(_SPI_BATCH_PERIOD_S)
            if _stopped.is_set():
                break
            with _spi_buf_lock:
                _flush_spi_batch_locked()
    threading.Thread(target=_spi_flush_loop, daemon=True, name='stm32-spi-flush').start()

    _emit({'type': 'system', 'event': 'booted'})
    _log(f'QEMU started: machine={machine}')

    for raw_line in os.fdopen(_orig_stdin_fd, 'r'):
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            cmd = json.loads(raw_line)
        except Exception:
            continue
        c = cmd.get('cmd', '')
        if c == 'set_pin':
            lib.qemu_picsimlab_set_pin(int(cmd['pin']), int(cmd['value']))
        elif c == 'uart_send':
            if hasattr(lib, 'qemu_picsimlab_uart_receive'):
                data = base64.b64decode(cmd.get('data', ''))
                if data:
                    buf = (ctypes.c_uint8 * len(data))(*data)
                    lib.qemu_picsimlab_uart_receive(int(cmd.get('uart', 0)), buf, len(data))
            else:
                _log('uart_send ignored: qemu_picsimlab_uart_receive not in libqemu-arm')
        elif c == 'set_i2c_response':
            _i2c_responses[int(cmd['addr'])] = int(cmd['response']) & 0xFF
        elif c == 'set_spi_response':
            _spi_response[0] = int(cmd['response']) & 0xFF
        elif c == 'sensor_attach':
            with _sensors_lock:
                try:
                    _register_sensor(cmd)
                    _sensors[int(cmd.get('pin', 0))] = dict(cmd)
                except Exception as e:
                    _log(f'sensor_attach failed: {e!r}')
            _log(f'sensor attached: {cmd.get("sensor_type")} i2c={list(_i2c_slaves.keys())}')
        elif c == 'sensor_update':
            # The SensorControlPanel sends {pin, <one-or-more changed values>}.
            # Look up the device by pin, merge the new values into its stored
            # record (panels change a single slider at a time), then push the
            # full state to the slave. Derive the I2C address from the record or
            # from the virtual-pin convention (pin = 200 + addr).
            with _sensors_lock:
                pin = int(cmd.get('pin', -1))
                rec = _sensors.get(pin)
                if rec is None and pin >= 200:
                    rec = {'addr': pin - 200}
                    _sensors[pin] = rec
                if rec is not None:
                    for k, v in cmd.items():
                        if k not in ('cmd', 'pin'):
                            rec[k] = v
                    addr = int(rec.get('addr', pin - 200 if pin >= 200 else -1))
                    stype = rec.get('sensor_type', '')
                    slave = _i2c_slaves.get(addr)
                    try:
                        if stype == 'bmp280' and slave is not None:
                            slave.update(float(rec.get('temperature', 25.0)),
                                         float(rec.get('pressure', 1013.25)))
                        elif stype == 'mpu6050' and slave is not None and hasattr(slave, 'update'):
                            slave.update(accel_x=float(rec.get('accelX', 0)),
                                         accel_y=float(rec.get('accelY', 0)),
                                         accel_z=float(rec.get('accelZ', 1)),
                                         gyro_x=float(rec.get('gyroX', 0)),
                                         gyro_y=float(rec.get('gyroY', 0)),
                                         gyro_z=float(rec.get('gyroZ', 0)),
                                         temp=float(rec.get('temp', 25.0)))
                        elif stype in ('ds3231',) and slave is not None and hasattr(slave, 'update'):
                            slave.update(float(rec.get('temperature', 25.0)))
                    except Exception as e:
                        _log(f'sensor_update failed: {e!r}')
        elif c == 'sensor_detach':
            with _sensors_lock:
                addr = int(cmd.get('addr', -1))
                _i2c_slaves.pop(addr, None)
        elif c == 'stop':
            _stopped.set()
            if _shutdown_request:
                try:
                    _shutdown_request(3)
                except Exception:
                    pass
            qemu_t.join(timeout=5.0)
            if firmware_path:
                try:
                    os.unlink(firmware_path)
                except OSError:
                    pass
            os._exit(0)


if __name__ == '__main__':
    main()
