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
  ARDUINO_CLI="$BINARIES_DIR/arduino-cli-$TRIPLE.exe"
else
  VENV_PYTHON="$ENGINE_DIR/venv-build/bin/python"
  SIDECAR="$BINARIES_DIR/circuit-muse-engine-$TRIPLE"
  ARDUINO_CLI="$BINARIES_DIR/arduino-cli-$TRIPLE"
fi

# Tauri declares both tools as external sidecars. Building only the Python
# engine left developers with a desktop shell that silently fell back to a
# system Arduino CLI (or couldn't compile at all). Make the engine build
# prepare the matching CLI sidecar too.
if [[ ! -s "$ARDUINO_CLI" ]]; then
  "$SCRIPT_DIR/download-deps.sh"
fi

# The pinned engine dependencies (fastapi 0.115) fail to import on Python
# 3.14 ("cannot import name 'eval_type_backport'"), and rolling distros such
# as Arch now ship 3.14 as python3. Use 3.12 or 3.13 explicitly.
pick_python() {
  local candidates=(python3.12 python3.13)
  if [[ "${WINDOWS:-false}" == true ]]; then candidates=("py -3.12" "py -3.13" python); else candidates+=(python3); fi
  # uv-managed interpreters are not on PATH by default.
  if command -v uv >/dev/null 2>&1; then
    local found
    for v in 3.12 3.13; do
      found="$(uv python find "$v" 2>/dev/null || true)"
      [[ -n "$found" ]] && candidates+=("$found")
    done
  fi
  for cmd in "${candidates[@]}"; do
    if $cmd -c 'import sys; sys.exit(0 if (3, 12) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then
      echo "$cmd"
      return 0
    fi
  done
  return 1
}

if [[ ! -x "$VENV_PYTHON" ]]; then
  if ! BUILD_PYTHON="$(pick_python)"; then
    echo "Python 3.12 or 3.13 is required to build the engine (3.14 is not supported yet)." >&2
    echo "Install one, for example: uv python install 3.12, then rerun this script." >&2
    exit 1
  fi
  echo "Creating build venv with $BUILD_PYTHON"
  $BUILD_PYTHON -m venv "$ENGINE_DIR/venv-build"
fi
"$VENV_PYTHON" -m pip install -r "$ENGINE_DIR/requirements.txt" pyinstaller
cd "$ENGINE_DIR"
"$VENV_PYTHON" -m PyInstaller --clean --noconfirm circuit-muse-engine.spec
mkdir -p "$BINARIES_DIR"
cp "$ENGINE_DIR/dist/circuit-muse-engine${WINDOWS:+.exe}" "$SIDECAR"
if [[ "${WINDOWS:-false}" != true ]]; then chmod 755 "$SIDECAR"; fi
echo "Built Tauri sidecar: $SIDECAR"
