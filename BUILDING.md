# Building CircuitMuse from Source

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | App build |
| Python | 3.12+ | Engine |
| Rust | stable | Tauri desktop shell |
| arduino-cli | 1.2+ | AVR/RP2040 compilation (bundled in releases) |

## Quick Start

```bash
git clone https://github.com/meshackbahati/circuit-muse.git
cd circuit-muse

# Install app dependencies
cd app && npm install && cd ..

# Install engine dependencies
cd engine && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..

# Start development
cd app && npm run dev &        # Frontend on http://localhost:5173
cd engine && uvicorn app.main:app --port 8001 &  # Engine on http://localhost:8001
```

Open http://localhost:5173 in your browser.

## Building the Desktop App

### Install Tauri CLI

```bash
cargo install tauri-cli --version "^2"
```

### Download arduino-cli

```bash
bash scripts/download-deps.sh
```

This downloads arduino-cli for your platform and places it in `src-tauri/binaries/`.

### Build

```bash
cd src-tauri
cargo tauri build
```

Output: `src-tauri/target/release/bundle/` contains:
- Linux: `.deb`, `.AppImage`
- Windows: `.msi`, `.exe` (NSIS)
- macOS: `.dmg`

### Dev Mode

```bash
cd src-tauri
cargo tauri dev
```

## Platform-Specific Dependencies

### Linux (Ubuntu/Debian)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  libgtk-3-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libudev-dev
```

### Linux (Arch)

```bash
sudo pacman -S webkit2gtk-4.1 appmenu-gtk-module libappindicator-gtk3 librsvg patchelf openssl gtk3 libsoup3
```

### macOS

```bash
xcode-select --install
```

### Windows

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload.

## Project Structure

```
circuit-muse/
├── app/                  # React + Vite + TypeScript
│   ├── src/agent/        # AI agent (providers, tools, chat)
│   ├── src/components/   # UI components
│   ├── src/simulation/   # CPU emulation bridges
│   ├── src/store/        # Zustand state
│   ├── src/services/     # Persistence, installers
│   └── src/desktop/      # Tauri integration
├── engine/               # FastAPI + Python
│   └── app/              # Routes, services, MCP
├── src-tauri/            # Rust + Tauri shell
│   ├── binaries/         # Bundled executables (arduino-cli)
│   ├── icons/            # App icons
│   └── src/commands/     # Rust commands
├── scripts/              # Build helpers
└── .github/workflows/    # CI/CD
```

## Running Tests

### App Tests

```bash
cd app
npm test
```

### Engine Tests

```bash
cd engine
python -m pytest tests/
```

### Rust Checks

```bash
cd src-tauri
cargo check
cargo test
```

## Troubleshooting

### "arduino-cli not found"

Run `bash scripts/download-deps.sh` or install arduino-cli manually.

### "libudev not found" (Linux)

Install `libudev-dev`:
```bash
sudo apt-get install libudev-dev
```

### "libwebkit2gtk not found" (Linux)

Install WebKit development files:
```bash
sudo apt-get install libwebkit2gtk-4.1-dev
```

### QEMU boards not working

The app auto-downloads QEMU on first use. If it fails:
1. Check your internet connection
2. The setup wizard (gear icon) shows QEMU status
3. Manual install: download from [Espressif QEMU releases](https://github.com/espressif/qemu/releases)

### Engine won't start

Check if port 8001 is in use:
```bash
lsof -i :8001
```

Kill any process using it, or set a different port in the engine config.
