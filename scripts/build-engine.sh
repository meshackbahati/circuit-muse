#!/usr/bin/env bash
# Build the FastAPI runner as the platform sidecar expected by Tauri.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="$PROJECT_ROOT/engine"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Linux/x86_64) TRIPLE=x86_64-unknown-linux-gnu ;;
  Linux/aarch64|Linux/arm64) TRIPLE=aarch64-unknown-linux-gnu ;;
  Darwin/x86_64) TRIPLE=x86_64-apple-darwin ;;
  Darwin/arm64) TRIPLE=aarch64-apple-darwin ;;
  MINGW*/x86_64|MSYS*/x86_64) TRIPLE=x86_64-pc-windows-msvc; WINDOWS=true ;;
  *) echo "Unsupported build host: $OS/$ARCH" >&2; exit 1 ;;
esac

if [[ "${WINDOWS:-false}" == true ]]; then
  VENV_PYTHON="$ENGINE_DIR/venv-build/Scripts/python.exe"
  SIDECAR="$BINARIES_DIR/circuit-muse-engine-$TRIPLE.exe"
else
  VENV_PYTHON="$ENGINE_DIR/venv-build/bin/python"
  SIDECAR="$BINARIES_DIR/circuit-muse-engine-$TRIPLE"
fi
if [[ ! -x "$VENV_PYTHON" ]]; then
  if [[ "${WINDOWS:-false}" == true ]]; then
    python -m venv "$ENGINE_DIR/venv-build"
  else
    python3 -m venv "$ENGINE_DIR/venv-build"
  fi
fi
"$VENV_PYTHON" -m pip install -r "$ENGINE_DIR/requirements.txt" pyinstaller
cd "$ENGINE_DIR"
"$VENV_PYTHON" -m PyInstaller --clean --noconfirm circuit-muse-engine.spec
mkdir -p "$BINARIES_DIR"
cp "$ENGINE_DIR/dist/circuit-muse-engine${WINDOWS:+.exe}" "$SIDECAR"
if [[ "${WINDOWS:-false}" != true ]]; then chmod 755 "$SIDECAR"; fi
echo "Built Tauri sidecar: $SIDECAR"
