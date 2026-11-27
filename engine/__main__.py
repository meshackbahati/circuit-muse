"""
CircuitMuse Engine entry point.
Auto-finds an available port and starts the server.
"""

import importlib.util
import os
import socket
import sys
import threading
import time

# Check that the engine's dependencies are installed without importing them.
# Importing wasmtime, esptool and mcp here only to test for presence loaded
# them into memory at startup, before any feature needed them.
_REQUIRED_MODULES = (
    "fastapi", "uvicorn", "websockets", "pydantic", "httpx",
    "mcp", "esptool", "wasmtime", "zstandard",
)
_missing = [name for name in _REQUIRED_MODULES if importlib.util.find_spec(name) is None]
if _missing:
    print(
        f"[CircuitMuse Engine] Missing dependency: {', '.join(_missing)}. "
        "For a source run, install engine/requirements.txt in a virtual environment.",
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(1)

import uvicorn  # noqa: E402

def find_available_port(start_port: int = 8001, max_port: int = 8100) -> int:
    """Find an available port starting from start_port."""
    for port in range(start_port, max_port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    return start_port  # fallback


def _process_alive(pid: int) -> bool:
    """Return True while ``pid`` is running. Never sends a signal on Windows."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _watch_parent(server: "uvicorn.Server", parent_pid: int, interval: float = 2.0) -> None:
    """Shut the engine down if the desktop app that started it has gone.

    Covers a crash or a forced kill of the app, where no stop signal reaches
    the engine. A normal uvicorn shutdown still runs, so emulator processes
    are stopped too.
    """
    while not server.should_exit:
        if not _process_alive(parent_pid):
            print("[CircuitMuse Engine] Desktop app exited, shutting down", flush=True)
            server.should_exit = True
            return
        time.sleep(interval)


def main():
    port = find_available_port()
    print(f"[CircuitMuse Engine] Starting on port {port}", flush=True)
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
        # Do not wait forever for open WebSockets when asked to stop.
        timeout_graceful_shutdown=3,
    )
    server = uvicorn.Server(config)

    parent_pid = os.environ.get("CIRCUIT_MUSE_PARENT_PID", "")
    if parent_pid.isdigit():
        threading.Thread(
            target=_watch_parent,
            args=(server, int(parent_pid)),
            name="parent-watchdog",
            daemon=True,
        ).start()

    server.run()


if __name__ == "__main__":
    main()
