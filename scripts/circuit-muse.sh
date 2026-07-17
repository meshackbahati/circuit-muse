#!/bin/bash
# CircuitMuse launcher with GPU compatibility fallback
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find AppImage anywhere in the same directory
APPIMAGE=$(find "$SCRIPT_DIR" -maxdepth 1 -name "*.AppImage" -type f 2>/dev/null | head -1)
if [ -n "$APPIMAGE" ]; then
    chmod +x "$APPIMAGE" 2>/dev/null
    exec "$APPIMAGE" "$@"
fi

# Try bare binary
BINARY=$(find "$SCRIPT_DIR" -maxdepth 1 -name "circuit-muse" -type f 2>/dev/null | head -1)
if [ -n "$BINARY" ] && [ -x "$BINARY" ]; then
    exec "$BINARY" "$@"
fi

echo "CircuitMuse not found. Place this script next to the AppImage and run it."
exit 1
