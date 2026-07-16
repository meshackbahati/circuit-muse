#!/bin/bash
# Build the Python engine as a standalone executable using PyInstaller
# This bundles the engine so users don't need Python installed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENGINE_DIR="$PROJECT_ROOT/engine"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"

echo "=== Building CircuitMuse Engine ==="

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required to build the engine"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "$ENGINE_DIR/venv-build" ]; then
    echo "Creating build virtual environment..."
    cd "$ENGINE_DIR"
    python3 -m venv venv-build
    source venv-build/bin/activate
    pip install -r requirements.txt
    pip install pyinstaller
else
    cd "$ENGINE_DIR"
    source venv-build/bin/activate
fi

echo "Building with PyInstaller..."
pyinstaller --clean --noconfirm circuit-muse-engine.spec

# Copy the built executable to binaries directory
mkdir -p "$BINARIES_DIR"

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    cp dist/circuit-muse-engine/circuit-muse-engine "$BINARIES_DIR/circuit-muse-engine"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    cp dist/circuit-muse-engine/circuit-muse-engine "$BINARIES_DIR/circuit-muse-engine"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    cp dist/circuit-muse-engine/circuit-muse-engine.exe "$BINARIES_DIR/circuit-muse-engine.exe"
fi

chmod +x "$BINARIES_DIR/circuit-muse-engine" 2>/dev/null || true

echo ""
echo "=== Engine built successfully ==="
ls -la "$BINARIES_DIR/circuit-muse-engine"*
