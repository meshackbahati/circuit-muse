"""Emulator processes must not outlive their client or the engine.

Each board family runs in its own process (QEMU or a worker). A socket that
closes, or an engine that exits, has to stop every one of them, otherwise the
processes keep their memory and CPU after the app is closed.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import pathlib
import subprocess
import sys

import pytest

from app.api.routes import simulation
from app.services.esp_qemu_manager import EspQemuManager
from app.services.qemu_manager import QemuManager

MANAGER_NAMES = (
    'qemu_manager',
    'esp_lib_manager',
    'esp_qemu_manager',
    'stm32_lib_manager',
    'picow_net_manager',
)


class _FakeManager:
    def __init__(self, *, is_async: bool, fail: bool = False) -> None:
        self.is_async = is_async
        self.fail = fail
        self.stopped: list[str] = []
        self.shutdown_calls = 0

    def stop_instance(self, client_id: str):
        if self.fail:
            raise RuntimeError('boom')
        if self.is_async:
            async def _stop() -> None:
                self.stopped.append(client_id)
            return _stop()
        self.stopped.append(client_id)
        return None

    async def shutdown_all(self) -> None:
        self.shutdown_calls += 1


def _install_fakes(monkeypatch: pytest.MonkeyPatch, failing: str | None = None):
    fakes = {}
    for name in MANAGER_NAMES:
        is_async = name in ('esp_lib_manager', 'stm32_lib_manager', 'picow_net_manager')
        fakes[name] = _FakeManager(is_async=is_async, fail=(name == failing))
        monkeypatch.setattr(simulation, name, fakes[name])
    return fakes


def test_disconnect_stops_every_board_family(monkeypatch: pytest.MonkeyPatch) -> None:
    fakes = _install_fakes(monkeypatch)
    asyncio.run(simulation.stop_client_instances('client-1'))
    for name, fake in fakes.items():
        assert fake.stopped == ['client-1'], name


def test_one_failing_manager_does_not_skip_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    fakes = _install_fakes(monkeypatch, failing='qemu_manager')
    asyncio.run(simulation.stop_client_instances('client-2'))
    for name, fake in fakes.items():
        if name != 'qemu_manager':
            assert fake.stopped == ['client-2'], name


def test_engine_shutdown_stops_all_managers(monkeypatch: pytest.MonkeyPatch) -> None:
    fakes = _install_fakes(monkeypatch)
    asyncio.run(simulation.stop_all_instances(timeout=2))
    for name, fake in fakes.items():
        assert fake.shutdown_calls == 1, name


@pytest.mark.parametrize('manager_cls', [QemuManager, EspQemuManager])
def test_shutdown_all_waits_for_each_instance(manager_cls) -> None:
    manager = manager_cls()
    shut: list[str] = []

    async def _fake_shutdown(inst) -> None:
        await asyncio.sleep(0)
        shut.append(inst)

    manager._shutdown = _fake_shutdown  # type: ignore[method-assign]
    manager._instances.update({'a': 'inst-a', 'b': 'inst-b'})

    asyncio.run(manager.shutdown_all())

    assert sorted(shut) == ['inst-a', 'inst-b']
    assert manager._instances == {}


def _load_entrypoint():
    path = pathlib.Path(__file__).resolve().parents[1] / '__main__.py'
    spec = importlib.util.spec_from_file_location('engine_entry', path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_entrypoint_does_not_import_heavy_modules() -> None:
    code = (
        'import importlib.util, sys, pathlib;'
        f'p = pathlib.Path({str(pathlib.Path(__file__).resolve().parents[1] / "__main__.py")!r});'
        'spec = importlib.util.spec_from_file_location("engine_entry", p);'
        'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m);'
        'print(",".join(n for n in ("wasmtime", "esptool", "mcp") if n in sys.modules))'
    )
    out = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == ''


def test_process_alive() -> None:
    entry = _load_entrypoint()
    assert entry._process_alive(os.getpid()) is True
    child = subprocess.Popen([sys.executable, '-c', 'pass'])
    child.wait()
    assert entry._process_alive(child.pid) is False


def test_watchdog_stops_server_when_parent_is_gone() -> None:
    entry = _load_entrypoint()

    class _Server:
        should_exit = False

    child = subprocess.Popen([sys.executable, '-c', 'pass'])
    child.wait()
    server = _Server()
    entry._watch_parent(server, child.pid, interval=0.01)
    assert server.should_exit is True


def test_engines_started_together_get_different_ports() -> None:
    entry = _load_entrypoint()
    socks = [entry.bind_available_port(8001, 8100) for _ in range(3)]
    try:
        ports = [s.getsockname()[1] for s in socks]
        assert len(set(ports)) == 3
    finally:
        for s in socks:
            s.close()


def test_falls_back_to_any_port_when_range_is_taken() -> None:
    entry = _load_entrypoint()
    blocker = entry.bind_available_port(8001, 8100)
    taken = blocker.getsockname()[1]
    try:
        sock = entry.bind_available_port(taken, taken + 1)  # only the taken port allowed
        try:
            assert sock.getsockname()[1] not in (taken, 0)
        finally:
            sock.close()
    finally:
        blocker.close()
