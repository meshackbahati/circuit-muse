#!/bin/bash
# CircuitMuse launcher with GPU compatibility fallback
# Set these BEFORE the webview initializes

export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1

# Find and run the app
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$SCRIPT_DIR/circuit-muse"

if [ -x "$APP" ]; then
    exec "$APP" "$@"
fi

# Try AppImage
APPIMAGE=$(find "$SCRIPT_DIR" -name "CircuitMuse_*.AppImage" -type f 2>/dev/null | head -1)
if [ -n "$APPIMAGE" ]; then
    exec "$APPIMAGE" "$@"
fi

echo "CircuitMuse not found in $SCRIPT_DIR"
exit 1
