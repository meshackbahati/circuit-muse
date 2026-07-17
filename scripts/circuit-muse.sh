#!/bin/bash
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1

DIR="$(dirname "$(readlink -f "$0")")"
for f in "$DIR"/*.AppImage "$DIR"/CircuitMuse*; do
  if [ -f "$f" ] && [ "$f" != "$0" ]; then
    chmod +x "$f" 2>/dev/null
    exec "$f" "$@"
  fi
done

echo "CircuitMuse not found next to this script."
exit 1
