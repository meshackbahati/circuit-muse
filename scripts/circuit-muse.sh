#!/bin/bash
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
for f in "$PROJECT_ROOT"/*.AppImage "$PROJECT_ROOT"/CircuitMuse* \
  "$PROJECT_ROOT"/src-tauri/target/release/bundle/appimage/*.AppImage; do
  if [ -f "$f" ] && [ "$f" != "$0" ]; then
    chmod +x "$f" 2>/dev/null
    exec "$f" "$@"
  fi
done

echo "CircuitMuse not found next to this script."
exit 1
