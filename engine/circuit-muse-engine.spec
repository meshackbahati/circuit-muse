# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for CircuitMuse Engine

block_cipher = None

a = Analysis(
    ['__main__.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        ('app/services/esp-idf-template', 'app/services/esp-idf-template'),
        ('app/mcp', 'app/mcp'),
    ],
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
    ],
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
