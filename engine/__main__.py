"""
CircuitMuse Engine entry point.
Auto-finds an available port and starts the server.
"""

import socket
import sys

try:
    import fastapi
    import uvicorn
    import websockets
    import pydantic
    import httpx
    import mcp
    import esptool
    import wasmtime
    import zstandard
except ImportError as exc:
    print(
        f"[CircuitMuse Engine] Missing dependency: {exc}. "
        "For a source run, install engine/requirements.txt in a virtual environment.",
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(1) from exc

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


def main():
    port = find_available_port()
    print(f"[CircuitMuse Engine] Starting on port {port}", flush=True)
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
