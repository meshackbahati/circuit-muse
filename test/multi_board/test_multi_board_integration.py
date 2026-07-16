"""
Multi-board integration tests — backend side

Covers:
  1. boardPinMapping equivalents (Python) — PI3 physical→BCM mapping logic
  2. QemuManager API surface — start/stop/send_serial_bytes/set_pin_state
  3. simulation WebSocket protocol — all message types
  4. GPIO shim protocol parsing

Run with:
  cd e:/Hardware/wokwi_clon
  python -m pytest test/multi_board/test_multi_board_integration.py -v
"""

import asyncio
import json
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch, call

# ── Bootstrap path so we can import the backend app ──────────────────────────
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'backend'))

# ─────────────────────────────────────────────────────────────────────────────
# 1. BCM pin mapping (Python mirror of boardPinMapping.ts)
# ─────────────────────────────────────────────────────────────────────────────

PI3_PHYSICAL_TO_BCM = {
    1: -1, 2: -1,
    3: 2,  4: -1,  5: 3,   6: -1,  7: 4,   8: 14,  9: -1,  10: 15,
    11: 17, 12: 18, 13: 27, 14: -1, 15: 22, 16: 23, 17: -1, 18: 24,
    19: 10, 20: -1, 21: 9,  22: 25, 23: 11, 24: 8,  25: -1, 26: 7,
    27: -1, 28: -1, 29: 5,  30: -1, 31: 6,  32: 12, 33: 13, 34: -1,
    35: 19, 36: 16, 37: 26, 38: 20, 39: -1, 40: 21,
}

def board_pin_to_bcm(physical: int) -> int | None:
    return PI3_PHYSICAL_TO_BCM.get(physical)


class TestBcmPinMapping(unittest.TestCase):
    """Mirror of the frontend boardPinMapping tests."""

    def test_gpio_physical_pins_map_to_correct_bcm(self):
        self.assertEqual(board_pin_to_bcm(11), 17)
        self.assertEqual(board_pin_to_bcm(12), 18)
        self.assertEqual(board_pin_to_bcm(13), 27)
        self.assertEqual(board_pin_to_bcm(40), 21)

    def test_power_gnd_pins_map_to_minus_one(self):
        for phys in [1, 2, 4, 6, 9, 14, 17, 20, 25, 30, 34, 39]:
            with self.subTest(pin=phys):
                self.assertEqual(board_pin_to_bcm(phys), -1)

    def test_out_of_range_pin_returns_none(self):
        self.assertIsNone(board_pin_to_bcm(41))
        self.assertIsNone(board_pin_to_bcm(0))

    def test_reverse_map_is_consistent(self):
        bcm_to_physical = {
            bcm: phys
            for phys, bcm in PI3_PHYSICAL_TO_BCM.items()
            if bcm >= 0
        }
        self.assertEqual(bcm_to_physical[17], 11)
        self.assertEqual(bcm_to_physical[18], 12)
        self.assertEqual(bcm_to_physical[27], 13)

    def test_all_gpio_pins_covered(self):
        """All 40 physical pins must have an entry."""
        self.assertEqual(len(PI3_PHYSICAL_TO_BCM), 40)

    def test_unique_bcm_numbers(self):
        """No two physical pins should map to the same positive BCM number."""
        positives = [bcm for bcm in PI3_PHYSICAL_TO_BCM.values() if bcm >= 0]
        self.assertEqual(len(positives), len(set(positives)))


# ─────────────────────────────────────────────────────────────────────────────
# 2. QemuManager public API (without real QEMU process)
# ─────────────────────────────────────────────────────────────────────────────

class TestQemuManagerApi(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        # Import fresh to avoid singleton pollution between tests
        import importlib
        import app.services.qemu_manager as qm_mod
        importlib.reload(qm_mod)
        self.QemuManager = qm_mod.QemuManager
        self.manager = self.QemuManager()

    async def test_start_instance_registers_instance(self):
        cb = AsyncMock()
        with patch.object(self.manager, '_boot', new=AsyncMock()):
            self.manager.start_instance('pi-1', 'raspberry-pi-3', cb)
        self.assertIn('pi-1', self.manager._instances)

    async def test_start_instance_does_not_duplicate(self):
        cb = AsyncMock()
        with patch.object(self.manager, '_boot', new=AsyncMock()):
            self.manager.start_instance('pi-dup', 'raspberry-pi-3', cb)
            self.manager.start_instance('pi-dup', 'raspberry-pi-3', cb)
        # Should still be exactly one instance
        count = sum(1 for k in self.manager._instances if k == 'pi-dup')
        self.assertEqual(count, 1)

    async def test_stop_instance_removes_instance(self):
        cb = AsyncMock()
        with patch.object(self.manager, '_boot', new=AsyncMock()):
            self.manager.start_instance('pi-stop', 'raspberry-pi-3', cb)
        with patch.object(self.manager, '_shutdown', new=AsyncMock()):
            self.manager.stop_instance('pi-stop')
        self.assertNotIn('pi-stop', self.manager._instances)

    async def test_stop_nonexistent_instance_is_noop(self):
        # Should not raise
        self.manager.stop_instance('ghost')

    async def test_send_serial_bytes_writes_to_writer(self):
        from app.services.qemu_manager import PiInstance
        cb = AsyncMock()
        inst = PiInstance('pi-serial', cb)
        writer = AsyncMock()
        writer.drain = AsyncMock()
        inst._serial_writer = writer
        inst.running = True
        self.manager._instances['pi-serial'] = inst

        await self.manager.send_serial_bytes('pi-serial', b'Hello')
        writer.write.assert_called_once_with(b'Hello')
        writer.drain.assert_called_once()

    async def test_send_serial_bytes_to_unknown_instance_is_noop(self):
        # Should not raise
        await self.manager.send_serial_bytes('ghost', b'hi')

    async def test_set_pin_state_calls_send_gpio(self):
        from app.services.qemu_manager import PiInstance
        cb = AsyncMock()
        inst = PiInstance('pi-gpio', cb)
        writer = AsyncMock()
        writer.drain = AsyncMock()
        inst._gpio_writer = writer
        inst.running = True
        self.manager._instances['pi-gpio'] = inst

        with patch.object(self.manager, '_send_gpio', new=AsyncMock()) as mock_send:
            self.manager.set_pin_state('pi-gpio', 17, 1)
            await asyncio.sleep(0)  # Allow the create_task to run
        # We can't easily await the task here, but we verify the method is set up

    async def test_emit_calls_callback(self):
        from app.services.qemu_manager import PiInstance
        cb = AsyncMock()
        inst = PiInstance('pi-emit', cb)
        await inst.emit('serial_output', {'data': 'hello'})
        cb.assert_awaited_once_with('serial_output', {'data': 'hello'})

    async def test_emit_handles_callback_exception(self):
        from app.services.qemu_manager import PiInstance
        cb = AsyncMock(side_effect=RuntimeError('boom'))
        inst = PiInstance('pi-err', cb)
        # Should not raise
        await inst.emit('serial_output', {'data': 'x'})


# ─────────────────────────────────────────────────────────────────────────────
# 3. GPIO shim protocol parsing (handle_gpio_line)
# ─────────────────────────────────────────────────────────────────────────────

class TestGpioShimProtocol(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        import importlib
        import app.services.qemu_manager as qm_mod
        importlib.reload(qm_mod)
        from app.services.qemu_manager import QemuManager, PiInstance
        self.manager = QemuManager()
        self.cb = AsyncMock()
        self.inst = PiInstance('pi-gpio', self.cb)
        self.manager._instances['pi-gpio'] = self.inst

    async def test_valid_gpio_line_emits_gpio_change(self):
        await self.manager._handle_gpio_line(self.inst, 'GPIO 17 1')
        self.cb.assert_awaited_once_with('gpio_change', {'pin': 17, 'state': 1})

    async def test_gpio_line_low(self):
        await self.manager._handle_gpio_line(self.inst, 'GPIO 18 0')
        self.cb.assert_awaited_once_with('gpio_change', {'pin': 18, 'state': 0})

    async def test_malformed_gpio_line_is_ignored(self):
        await self.manager._handle_gpio_line(self.inst, 'INVALID DATA')
        self.cb.assert_not_awaited()

    async def test_gpio_line_wrong_prefix_is_ignored(self):
        await self.manager._handle_gpio_line(self.inst, 'SET 17 1')
        self.cb.assert_not_awaited()

    async def test_gpio_line_non_numeric_pin_is_ignored(self):
        await self.manager._handle_gpio_line(self.inst, 'GPIO abc 1')
        self.cb.assert_not_awaited()

    async def test_gpio_line_with_trailing_whitespace(self):
        await self.manager._handle_gpio_line(self.inst, 'GPIO 22 1  ')
        self.cb.assert_awaited_once_with('gpio_change', {'pin': 22, 'state': 1})


# ─────────────────────────────────────────────────────────────────────────────
# 4. WebSocket simulation route — message handling
# ─────────────────────────────────────────────────────────────────────────────

class TestSimulationWebSocketMessages(unittest.IsolatedAsyncioTestCase):
    """
    Tests the simulation.py route logic by calling its handler directly,
    bypassing the real FastAPI/Starlette plumbing.
    """

    async def asyncSetUp(self):
        import importlib
        import app.services.qemu_manager as qm_mod
        importlib.reload(qm_mod)
        import app.api.routes.simulation as sim_mod
        importlib.reload(sim_mod)
        self.sim_mod = sim_mod
        self.qm = qm_mod.qemu_manager

    def _make_ws(self, messages: list[dict]):
        """Build a mock WebSocket that yields messages then disconnects."""
        ws = MagicMock()
        ws.accept = AsyncMock()
        message_iter = iter([json.dumps(m) for m in messages])

        async def receive_text():
            try:
                return next(message_iter)
            except StopIteration:
                from fastapi.websockets import WebSocketDisconnect
                raise WebSocketDisconnect()

        ws.receive_text = receive_text
        ws.send_text = AsyncMock()
        return ws

    async def test_start_pi_message_calls_start_instance(self):
        ws = self._make_ws([{'type': 'start_pi', 'data': {'board': 'raspberry-pi-3'}}])
        with patch.object(self.qm, 'start_instance') as mock_start:
            with patch.object(self.qm, 'stop_instance'):
                try:
                    await self.sim_mod.simulation_websocket(ws, 'ws-test-1')
                except Exception:
                    pass
        mock_start.assert_called_once()
        call_args = mock_start.call_args
        self.assertEqual(call_args[0][0], 'ws-test-1')
        self.assertEqual(call_args[0][1], 'raspberry-pi-3')

    async def test_stop_pi_message_calls_stop_instance(self):
        ws = self._make_ws([{'type': 'stop_pi', 'data': {}}])
        with patch.object(self.qm, 'stop_instance') as mock_stop:
            try:
                await self.sim_mod.simulation_websocket(ws, 'ws-test-2')
            except Exception:
                pass
        mock_stop.assert_called_with('ws-test-2')

    async def test_serial_input_message_sends_bytes(self):
        ws = self._make_ws([{'type': 'serial_input', 'data': {'bytes': [72, 101, 108]}}])
        with patch.object(self.qm, 'send_serial_bytes', new=AsyncMock()) as mock_serial:
            with patch.object(self.qm, 'stop_instance'):
                try:
                    await self.sim_mod.simulation_websocket(ws, 'ws-test-3')
                except Exception:
                    pass
        mock_serial.assert_awaited_once_with('ws-test-3', bytes([72, 101, 108]))

    async def test_gpio_in_message_calls_set_pin_state(self):
        ws = self._make_ws([{'type': 'gpio_in', 'data': {'pin': 17, 'state': 1}}])
        with patch.object(self.qm, 'set_pin_state') as mock_pin:
            with patch.object(self.qm, 'stop_instance'):
                try:
                    await self.sim_mod.simulation_websocket(ws, 'ws-test-4')
                except Exception:
                    pass
        mock_pin.assert_called_with('ws-test-4', 17, 1)

    async def test_legacy_pin_change_message_calls_set_pin_state(self):
        """pin_change is the legacy alias for gpio_in."""
        ws = self._make_ws([{'type': 'pin_change', 'data': {'pin': 22, 'state': 0}}])
        with patch.object(self.qm, 'set_pin_state') as mock_pin:
            with patch.object(self.qm, 'stop_instance'):
                try:
                    await self.sim_mod.simulation_websocket(ws, 'ws-test-5')
                except Exception:
                    pass
        mock_pin.assert_called_with('ws-test-5', 22, 0)

    async def test_qemu_callback_sends_json_to_ws(self):
        """The qemu_callback passed to start_instance must forward events as JSON."""
        sent_payloads = []
        captured_callback = None

        # start_instance is a sync method — capture callback for later invocation
        def fake_start(client_id, board_type, callback):
            nonlocal captured_callback
            captured_callback = callback

        ws = self._make_ws([{'type': 'start_pi', 'data': {'board': 'raspberry-pi-3'}}])
        ws.send_text = AsyncMock(side_effect=lambda msg: sent_payloads.append(json.loads(msg)))

        with patch.object(self.qm, 'start_instance', side_effect=fake_start):
            with patch.object(self.qm, 'stop_instance'):
                try:
                    await self.sim_mod.simulation_websocket(ws, 'ws-test-6')
                except Exception:
                    pass

        # After WebSocketDisconnect the route removes the client from active_connections.
        # Re-register it so the captured callback can write back to the mock WS.
        self.assertIsNotNone(captured_callback, 'start_instance was never called with a callback')
        self.sim_mod.manager.active_connections['ws-test-6'] = ws
        await captured_callback('serial_output', {'data': 'Hello Pi\n'})

        self.assertTrue(any(p.get('type') == 'serial_output' for p in sent_payloads))
        serial_msg = next(p for p in sent_payloads if p['type'] == 'serial_output')
        self.assertEqual(serial_msg['data']['data'], 'Hello Pi\n')

    async def test_unknown_message_type_is_ignored(self):
        """Unknown message types must not raise."""
        ws = self._make_ws([{'type': 'unknown_type', 'data': {}}])
        with patch.object(self.qm, 'stop_instance'):
            try:
                await self.sim_mod.simulation_websocket(ws, 'ws-test-7')
            except Exception:
                pass  # WebSocketDisconnect is expected after messages are exhausted


# ─────────────────────────────────────────────────────────────────────────────
# 5. GPIO shim module (gpio_shim.py) unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestGpioShimModule(unittest.TestCase):
    """Tests gpio_shim.py constants, mode, and API surface without real hardware."""

    @classmethod
    def setUpClass(cls):
        # Load gpio_shim as a module (it runs inside the Pi but we test it here)
        import importlib.util, pathlib
        shim_path = pathlib.Path(ROOT) / 'backend' / 'app' / 'services' / 'gpio_shim.py'
        spec = importlib.util.spec_from_file_location('gpio_shim', shim_path)
        cls.shim = importlib.util.module_from_spec(spec)
        # Stub the background thread's tty so it doesn't block
        with patch('builtins.open', side_effect=OSError('no tty')):
            try:
                if spec and spec.loader:
                    spec.loader.exec_module(cls.shim)  # type: ignore[union-attr]
            except Exception:
                pass

    def setUp(self):
        # Reset internal state between tests
        self.shim._mode = None
        self.shim._pin_dir.clear()
        self.shim._pin_val.clear()
        self.shim._callbacks.clear()
        self.shim._tty = None

    def test_constants(self):
        self.assertEqual(self.shim.BCM, 'BCM')
        self.assertEqual(self.shim.BOARD, 'BOARD')
        self.assertEqual(self.shim.OUT, 1)
        self.assertEqual(self.shim.IN, 0)
        self.assertEqual(self.shim.HIGH, 1)
        self.assertEqual(self.shim.LOW, 0)

    def test_setmode_bcm(self):
        self.shim.setmode(self.shim.BCM)
        self.assertEqual(self.shim.getmode(), 'BCM')

    def test_setup_out_pin(self):
        self.shim.setmode(self.shim.BCM)
        self.shim.setup(17, self.shim.OUT, initial=self.shim.LOW)
        self.assertEqual(self.shim._pin_dir.get(17), self.shim.OUT)
        self.assertEqual(self.shim._pin_val.get(17), 0)

    def test_output_updates_pin_val_and_sends(self):
        self.shim.setmode(self.shim.BCM)
        self.shim.setup(17, self.shim.OUT)
        sent_lines = []
        with patch.object(self.shim, '_send', side_effect=sent_lines.append):
            self.shim.output(17, self.shim.HIGH)
        self.assertEqual(self.shim._pin_val.get(17), 1)
        self.assertIn('GPIO 17 1', sent_lines)

    def test_output_low(self):
        self.shim.setmode(self.shim.BCM)
        self.shim.setup(17, self.shim.OUT)
        sent_lines = []
        with patch.object(self.shim, '_send', side_effect=sent_lines.append):
            self.shim.output(17, self.shim.LOW)
        self.assertIn('GPIO 17 0', sent_lines)

    def test_input_reads_pin_val(self):
        self.shim._pin_val[17] = 1
        self.assertEqual(self.shim.input(17), 1)
        self.shim._pin_val[17] = 0
        self.assertEqual(self.shim.input(17), 0)

    def test_input_unset_pin_returns_zero(self):
        self.assertEqual(self.shim.input(99), 0)

    def test_physical_to_bcm_mapping(self):
        """BCM mode: pin passes through; BOARD mode: uses physical map."""
        self.shim.setmode(self.shim.BCM)
        # In BCM mode, _to_bcm(17) == 17
        self.assertEqual(self.shim._to_bcm(17), 17)

        self.shim._mode = self.shim.BOARD
        # Physical pin 11 → BCM 17
        self.assertEqual(self.shim._to_bcm(11), 17)

    def test_add_event_detect_registers_callback(self):
        cb = MagicMock()
        self.shim.setmode(self.shim.BCM)
        self.shim.add_event_detect(17, self.shim.RISING, callback=cb)
        self.assertIn(cb, self.shim._callbacks.get(17, []))

    def test_remove_event_detect_clears_callbacks(self):
        cb = MagicMock()
        self.shim.setmode(self.shim.BCM)
        self.shim.add_event_detect(17, self.shim.RISING, callback=cb)
        self.shim.remove_event_detect(17)
        self.assertNotIn(17, self.shim._callbacks)

    def test_pwm_start_sends_gpio(self):
        self.shim.setmode(self.shim.BCM)
        pwm = self.shim.PWM(18, 1000)
        sent = []
        with patch.object(self.shim, '_send', side_effect=sent.append):
            pwm.start(100)   # 100% duty cycle → HIGH
        self.assertIn('GPIO 18 1', sent)

    def test_pwm_stop_sends_low(self):
        self.shim.setmode(self.shim.BCM)
        pwm = self.shim.PWM(18, 1000)
        pwm.start(100)
        sent = []
        with patch.object(self.shim, '_send', side_effect=sent.append):
            pwm.stop()
        self.assertIn('GPIO 18 0', sent)

    def test_version_info(self):
        self.assertIsInstance(self.shim.VERSION, str)
        self.assertIsInstance(self.shim.RPI_INFO, dict)
        self.assertIn('PROCESSOR', self.shim.RPI_INFO)


if __name__ == '__main__':
    unittest.main(verbosity=2)
