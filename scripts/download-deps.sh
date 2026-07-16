#!/bin/bash
# Download external dependencies for bundling
# Run this before `cargo tauri build`

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"

echo "=== Downloading arduino-cli ==="
ARDUINO_CLI_VERSION="1.5.1"

download_arduino_cli() {
    local os=$1
    local arch=$2
    local suffix=$3
    local target=""

    case "$os-$arch" in
        linux-x86_64) target="x86_64-pc-linux-gnu" ;;
        linux-aarch64) target="aarch64-unknown-linux-gnu" ;;
        darwin-x86_64) target="x86_64-apple-darwin" ;;
        darwin-arm64) target="aarch64-apple-darwin" ;;
        mingw*-x86_64|windows-x86_64) target="x86_64-pc-windows-msvc" ;;
        *) echo "Skipping $os-$arch"; return ;;
    esac

    local url="https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_${target}.${suffix}"
    local dest="$BINARIES_DIR/arduino-cli-${target}${suffix:+.$suffix}"

    if [ -f "$dest" ]; then
        echo "  Already exists: $dest"
        return
    fi

    echo "  Downloading for $target..."
    curl -sL "$url" -o "$dest"
    chmod +x "$dest" 2>/dev/null || true
    echo "  Downloaded: $dest"
}

# Download for current platform
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [ "$OS" = "linux" ]; then
    download_arduino_cli "linux" "$ARCH" ""
elif [ "$OS" = "darwin" ]; then
    download_arduino_cli "darwin" "$ARCH" ""
elif [[ "$OS" == *"mingw"* ]] || [[ "$OS" == *"msys"* ]]; then
    download_arduino_cli "windows" "x86_64" "zip"
fi

echo ""
echo "=== Dependencies downloaded ==="
ls -la "$BINARIES_DIR/"
