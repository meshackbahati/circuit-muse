#!/usr/bin/env bash
# Download the arduino-cli sidecar for the current build host.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
VERSION="1.5.1"
mkdir -p "$BINARIES_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Linux/x86_64) TRIPLE=x86_64-unknown-linux-gnu; ASSET=Linux_64bit.tar.gz ;;
  Linux/aarch64|Linux/arm64) TRIPLE=aarch64-unknown-linux-gnu; ASSET=Linux_ARM64.tar.gz ;;
  Darwin/x86_64) TRIPLE=x86_64-apple-darwin; ASSET=macOS_64bit.tar.gz ;;
  Darwin/arm64) TRIPLE=aarch64-apple-darwin; ASSET=macOS_ARM64.tar.gz ;;
  MINGW*/x86_64|MSYS*/x86_64) TRIPLE=x86_64-pc-windows-msvc; ASSET=Windows_64bit.zip; WINDOWS=true ;;
  *) echo "Unsupported build host: $OS/$ARCH" >&2; exit 1 ;;
esac

DEST="$BINARIES_DIR/arduino-cli-$TRIPLE"
if [[ "${WINDOWS:-false}" == true ]]; then DEST="$DEST.exe"; fi
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
URL="https://github.com/arduino/arduino-cli/releases/download/v${VERSION}/arduino-cli_${VERSION}_${ASSET}"
echo "Downloading arduino-cli $VERSION for $TRIPLE"
curl --fail --location --retry 3 "$URL" -o "$TMP_DIR/archive"
case "$ASSET" in
  *.tar.gz) tar -xzf "$TMP_DIR/archive" -C "$TMP_DIR" ;;
  *.zip) unzip -q "$TMP_DIR/archive" -d "$TMP_DIR" ;;
esac
SOURCE="$TMP_DIR/arduino-cli"
[[ -f "$SOURCE.exe" ]] && SOURCE="$SOURCE.exe"
[[ -f "$SOURCE" ]] || { echo "arduino-cli executable missing from $URL" >&2; exit 1; }
install -m 755 "$SOURCE" "$DEST"
echo "Installed $DEST"
