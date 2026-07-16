"""
Velxio MCP Server — HTTP/SSE entry point

Run this script to start the MCP server using the SSE transport, which is
compatible with HTTP-based MCP clients (e.g. web applications, Cursor IDE).

The SSE server runs on port 8002 by default (separate from the main FastAPI
backend on port 8001) to avoid Starlette version conflicts.

Usage:
    python mcp_sse_server.py [--port 8002] [--host 0.0.0.0]

MCP client configuration (SSE transport):
    {
      "mcpServers": {
        "velxio": {
          "url": "http://localhost:8002/sse"
        }
      }
    }
"""

import sys
import argparse
from pathlib import Path

import uvicorn

# Ensure the backend package is importable when run as a script
sys.path.insert(0, str(Path(__file__).parent))

from app.mcp.server import mcp  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Velxio MCP SSE Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8002, help="Port to listen on")
    args = parser.parse_args()

    print(f"Starting Velxio MCP SSE server on {args.host}:{args.port}")
    print(f"SSE endpoint: http://{args.host}:{args.port}/sse")
    print(f"Tools: compile_project, run_project, import_wokwi_json, export_wokwi_json,")
    print(f"       create_circuit, update_circuit, generate_code_files")

    sse_app = mcp.sse_app()
    uvicorn.run(sse_app, host=args.host, port=args.port)
