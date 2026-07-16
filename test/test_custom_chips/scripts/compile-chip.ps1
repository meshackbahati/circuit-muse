# Compile a Velxio custom chip from C → WASM (Windows PowerShell).
# Usage:
#   .\scripts\compile-chip.ps1 <input.c> <output.wasm>
#
# Requires: $env:WASI_SDK pointing to the wasi-sdk install.
param(
  [Parameter(Mandatory=$true)] [string]$Input,
  [Parameter(Mandatory=$true)] [string]$Output
)

$ErrorActionPreference = 'Stop'

if (-not $env:WASI_SDK) {
  foreach ($candidate in @('C:\wasi-sdk','C:\Program Files\wasi-sdk')) {
    if (Test-Path "$candidate\bin\clang.exe") { $env:WASI_SDK = $candidate; break }
  }
}

if (-not $env:WASI_SDK -or -not (Test-Path "$env:WASI_SDK\bin\clang.exe")) {
  Write-Error "wasi-sdk not found. Set `$env:WASI_SDK. See scripts/setup-wasi-sdk.md."
}

$SDKInclude = Join-Path $PSScriptRoot '..\sdk\include'
$OutDir = Split-Path -Parent $Output
if ($OutDir -and -not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

& "$env:WASI_SDK\bin\clang.exe" `
  --target=wasm32-unknown-wasip1 `
  -O2 `
  -nostartfiles `
  -Wl,--import-memory `
  -Wl,--export-table `
  -Wl,--no-entry `
  -Wl,--export=chip_setup `
  -Wl,--allow-undefined `
  -I"$SDKInclude" `
  "$Input" `
  -o "$Output"

$size = (Get-Item $Output).Length
Write-Host "OK  $Output ($size bytes)"
