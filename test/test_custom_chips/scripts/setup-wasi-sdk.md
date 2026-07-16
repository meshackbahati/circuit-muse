# wasi-sdk setup

The compile scripts need `wasi-sdk` (clang + wasi-libc bundled by the WebAssembly project).
Apache 2.0 licensed. Independent of Wokwi or any other simulator vendor.

Releases: https://github.com/WebAssembly/wasi-sdk/releases

## Linux / macOS

```bash
curl -L https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-linux.tar.gz \
  | sudo tar -xz -C /opt
sudo mv /opt/wasi-sdk-22.0 /opt/wasi-sdk
echo 'export WASI_SDK=/opt/wasi-sdk' >> ~/.bashrc
export WASI_SDK=/opt/wasi-sdk
```

## Windows

```powershell
$ErrorActionPreference = 'Stop'
$tmp = "$env:TEMP\wasi-sdk.tar.gz"
Invoke-WebRequest `
  https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-22/wasi-sdk-22.0-mingw.tar.gz `
  -OutFile $tmp
tar -xzf $tmp -C C:\
Move-Item C:\wasi-sdk-22.0 C:\wasi-sdk
[Environment]::SetEnvironmentVariable('WASI_SDK', 'C:\wasi-sdk', 'User')
$env:WASI_SDK = 'C:\wasi-sdk'
```

(Reabrir la consola para que tome el env var permanente.)

## Verificar

```bash
$WASI_SDK/bin/clang --version
# debe imprimir: clang version 18.x.x ... Target: wasm32-unknown-wasi
```

## Compilar los ejemplos

```bash
cd test/test_custom_chips
bash scripts/compile-all.sh
```

Salida esperada:
```
✓ fixtures/inverter.wasm (~3 KB)
✓ fixtures/eeprom-24c01.wasm (~10 KB)
```
