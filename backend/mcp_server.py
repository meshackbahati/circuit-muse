"""
Velxio MCP Server — stdio entry point

Run this script to start the MCP server in stdio mode, which is compatible
with Claude Desktop and other stdio-based MCP clients.

Usage:
    python mcp_server.py

Claude Desktop configuration (~/.claude/claude_desktop_config.json):
    {
      "mcpServers": {
        "velxio": {
          "command": "python",
          "args": ["/path/to/velxio/backend/mcp_server.py"],
          "env": {}
        }
      }
    }
"""

import sys
from pathlib import Path

# Ensure the backend package is importable when run as a script
sys.path.insert(0, str(Path(__file__).parent))

from app.mcp.server import mcp  # noqa: E402

if __name__ == "__main__":
    mcp.run(transport="stdio")
