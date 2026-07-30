"""
CircuitMuse Engine entry point.
Auto-finds an available port and starts the server.
"""

import os
import socket
import sys
import subprocess

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
except ImportError:
    print("[CircuitMuse Engine] Missing dependencies. Installing via pip...", flush=True)
    try:
        req_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
        if os.path.exists(req_path):
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", req_path],
                check=True
            )
        else:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "fastapi", "uvicorn[standard]", "websockets", "pydantic", "pydantic-settings", "httpx", "mcp", "esptool", "wasmtime", "zstandard"],
                check=True
            )
    except Exception as e:
        print(f"[CircuitMuse Engine] Failed to install dependencies: {e}", flush=True)

import uvicorn


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
