# Pipeline de compilación C → WASM

## Toolchain

- **clang** — incluido en `wasi-sdk`. Frontend de LLVM.
- **wasi-sdk** — bundle oficial del proyecto WebAssembly. Apache 2.0.
  - Releases: https://github.com/WebAssembly/wasi-sdk/releases
  - Última probada: `wasi-sdk-22.0` (2026-04-27).
- **wasi-libc** — la libc de WASI, ya incluida en `wasi-sdk`.

Cero dependencia de Wokwi.

## Comando exacto

```bash
$WASI_SDK/bin/clang \
  --target=wasm32-unknown-wasi \
  -O2 \
  -nostartfiles \
  -Wl,--import-memory \
  -Wl,--export-table \
  -Wl,--no-entry \
  -Wl,--export=chip_setup \
  -I<velxio-chip-sdk>/include \
  chip.c \
  -o chip.wasm
```

### Qué hace cada flag

| Flag | Para qué |
|---|---|
| `--target=wasm32-unknown-wasi` | Backend de LLVM apunta a WebAssembly + WASI |
| `-nostartfiles` | No incluir `crt0` — no hay `main` |
| `-Wl,--import-memory` | El host provee la `WebAssembly.Memory`, el módulo no la crea |
| `-Wl,--export-table` | Expone la function table para que el host invoque callbacks |
| `-Wl,--no-entry` | Sin función `_start` — solo exports |
| `-Wl,--export=chip_setup` | Garantiza que `chip_setup` quede exportado aunque el linker quiera DCE-arlo |

## Setup de wasi-sdk (manual, una sola vez)

### Linux / macOS

```bash
cd /opt
sudo curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-linux.tar.gz \
  | sudo tar -xz
sudo mv wasi-sdk-22.0 wasi-sdk
export WASI_SDK=/opt/wasi-sdk
```

### Windows

```powershell
$ErrorActionPreference = 'Stop'
mkdir C:\wasi-sdk -Force
Invoke-WebRequest `
  https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-mingw.tar.gz `
  -OutFile $env:TEMP\wasi-sdk.tar.gz
tar -xzf $env:TEMP\wasi-sdk.tar.gz -C C:\
mv C:\wasi-sdk-22.0 C:\wasi-sdk
[Environment]::SetEnvironmentVariable('WASI_SDK', 'C:\wasi-sdk', 'User')
```

## Setup en producción (backend Velxio)

Dockerfile snippet para el container del backend:

```dockerfile
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y curl xz-utils
ENV WASI_SDK_VERSION=22
RUN curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-linux.tar.gz \
    | tar -xz -C /opt && mv /opt/wasi-sdk-${WASI_SDK_VERSION}.0 /opt/wasi-sdk
ENV PATH=/opt/wasi-sdk/bin:$PATH
ENV WASI_SDK=/opt/wasi-sdk
```

El servicio FastAPI llama a clang via `subprocess.run([...])` igual que ya lo hace con `arduino-cli`.
Tamaño extra del image: ~150 MB.

## Tamaño esperado del .wasm

- Inverter trivial: ~2-4 KB
- Chip con I2C + estado: ~10-30 KB
- Chip complejo con `malloc` heavy + printf: ~40-80 KB

Aceptable para almacenarlo por proyecto en SQLite.

## Probar localmente

Desde `test/test_custom_chips/`:

```bash
bash scripts/compile-chip.sh sdk/examples/inverter.c fixtures/inverter.wasm
# o en Windows:
.\scripts\compile-chip.ps1 sdk\examples\inverter.c fixtures\inverter.wasm
```
