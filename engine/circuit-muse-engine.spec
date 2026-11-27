# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for CircuitMuse Engine
import platform
import sys
from importlib.util import find_spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

block_cipher = None
wasmtime_datas, wasmtime_binaries, wasmtime_hiddenimports = collect_all('wasmtime')
wasmtime_spec = find_spec('wasmtime')
if wasmtime_spec is None or wasmtime_spec.origin is None:
    raise ImportError('Wasmtime Python package is not installed in the build environment')
wasmtime_dir = Path(wasmtime_spec.origin).parent
machine = platform.machine().lower()
if machine in ('amd64', 'arm64'):
    machine = {'amd64': 'x86_64', 'arm64': 'aarch64'}[machine]
wasmtime_platform = f'{sys.platform}-{machine}'
wasmtime_library = {
    'linux': '_libwasmtime.so',
    'darwin': '_libwasmtime.dylib',
    'win32': '_wasmtime.dll',
}[sys.platform]
wasmtime_native_library = wasmtime_dir / wasmtime_platform / wasmtime_library
if not wasmtime_native_library.is_file():
    raise FileNotFoundError(f'Wasmtime native library is missing: {wasmtime_native_library}')
wasmtime_binaries.append((str(wasmtime_native_library), f'wasmtime/{wasmtime_platform}'))

a = Analysis(
    ['__main__.py'],
    pathex=['.'],
    binaries=wasmtime_binaries,
    datas=[
        ('app/services/esp-idf-template', 'app/services/esp-idf-template'),
        ('app/services/boot_images', 'app/services/boot_images'),
        ('app/mcp', 'app/mcp'),
        # Header for custom chip compilation (chip_compile.py looks in sdk/).
        ('sdk', 'sdk'),
    ] + wasmtime_datas,
    hiddenimports=[
        'app.main',
        'multipart',
        'multipart.multipart',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'pydantic',
        'pydantic_settings',
        'httpx',
        'websockets',
        'serial',
        'mcp',
        'esptool',
        'wasmtime',
        'zstandard',
    ] + wasmtime_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='circuit-muse-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
