# Building QEMU from source for Velxio

The Velxio docker image ships with prebuilt `libqemu-xtensa` and
`libqemu-riscv32` libraries so ESP32 / ESP32-S3 / ESP32-C3 simulation
works out of the box. If you'd rather not use the prebuilts —
whether for licensing reasons, audit requirements, or simply because
you prefer to compile what you run — this guide walks you through
building both libraries from the upstream
[`lcgamboa/qemu`](https://github.com/lcgamboa/qemu) fork.

Velxio itself is **AGPLv3**, and that includes the binary linker
contract: you have the source, you can rebuild, you can verify the
chain end-to-end.

> The prebuilts at `velxio.dev/license/signup` and on GitHub Releases
> are a convenience, not a gate. Everything in this guide produces
> the exact same `.so` / `.dll` / `.dylib` files those bundles
> contain, byte-for-byte modulo timestamps.

## Audience

This guide assumes a Linux or macOS workstation with a working C
toolchain. Windows builds are possible via MSYS2 / MinGW but are
out of scope here — start from `lcgamboa/qemu`'s own README if you
need them.

## What you'll produce

| File | Architecture | Used for |
|---|---|---|
| `libqemu-xtensa.so` | Xtensa LX6 / LX7 | ESP32, ESP32-S3, ESP32-CAM, Arduino Nano ESP32 |
| `libqemu-riscv32.so` | RISC-V RV32IMC | ESP32-C3, XIAO ESP32-C3, CH32V003 |

The Velxio backend dlopen's these at runtime through the dynamic
linker (`backend/app/services/qemu_runtime.py`). Drop the freshly
built files into `/app/lib/` inside the container (or the host
path that mounts to it) and Velxio will use them on the next
simulation start.

## 1. Clone the fork

```bash
git clone https://github.com/lcgamboa/qemu.git
cd qemu
git checkout 822927b6  # the commit Velxio's prebuilts are anchored to
```

The exact commit ID may move forward over time. The Velxio docker
image's `Dockerfile.standalone` records the canonical SHA — `grep -E
'qemu.*checkout|QEMU_REF' Dockerfile.standalone` to read it.

## 2. Install build dependencies

**Debian / Ubuntu**:

```bash
sudo apt-get update
sudo apt-get install -y \
    git ninja-build pkg-config \
    libglib2.0-dev libpixman-1-dev \
    python3 python3-venv python3-pip \
    flex bison
```

**Arch / Manjaro**:

```bash
sudo pacman -S --needed \
    git ninja pkgconf \
    glib2 pixman \
    python flex bison
```

**macOS** (Homebrew):

```bash
brew install ninja pkg-config glib pixman
```

## 3. Configure and build — Xtensa (ESP32 / ESP32-S3)

```bash
mkdir build-xtensa && cd build-xtensa
../configure \
    --target-list=xtensa-softmmu \
    --disable-werror \
    --enable-shared-lib \
    --disable-tools \
    --disable-docs
ninja
```

This produces `libqemu-xtensa.so` under `build-xtensa/`. Verify:

```bash
file libqemu-xtensa.so
# ELF 64-bit LSB shared object, x86-64, dynamically linked

ls -lh libqemu-xtensa.so
# ~46 MB on Linux x86_64
```

Go back to the repo root:

```bash
cd ..
```

## 4. Configure and build — RISC-V (ESP32-C3)

```bash
mkdir build-riscv32 && cd build-riscv32
../configure \
    --target-list=riscv32-softmmu \
    --disable-werror \
    --enable-shared-lib \
    --disable-tools \
    --disable-docs
ninja
cd ..
```

You now have `build-riscv32/libqemu-riscv32.so`.

## 5. Drop the binaries into Velxio

If you self-host Velxio via the official docker image:

```bash
docker cp build-xtensa/libqemu-xtensa.so   velxio:/app/lib/libqemu-xtensa.so
docker cp build-riscv32/libqemu-riscv32.so velxio:/app/lib/libqemu-riscv32.so
docker restart velxio
```

If you're running Velxio from source:

```bash
cp build-xtensa/libqemu-xtensa.so   /path/to/velxio/backend/app/lib/
cp build-riscv32/libqemu-riscv32.so /path/to/velxio/backend/app/lib/
# restart the backend
```

The next ESP32 / ESP32-C3 simulation start will use your libraries.
Check the backend logs for a line like:

```
[qemu_runtime] loaded libqemu-xtensa.so build=<your-hash>
```

## 6. ESP32 ROM blobs

The QEMU build does not produce the ESP32 ROM dumps Velxio also
needs (`esp32-v3-rom.bin`, `esp32-v3-rom-app.bin`, `esp32c3-rom.bin`).
Those come straight from Espressif's open-source toolchain and are
redistributable verbatim. The image already includes them at
`/app/lib/`; you only need to replace them if you're working from a
custom esp-idf version.

## 7. Troubleshooting

**`No such file or directory: glib-2.0`** — apt missed
`libglib2.0-dev`. Re-run the dependencies step.

**`error: ‘CONFIG_USER_ONLY’ is not defined`** — you forgot
`--target-list=`. The `softmmu` suffix is required for the system
emulator Velxio uses.

**Shared library is too small** (a few hundred KB) — you built
without `--enable-shared-lib`. The default QEMU output is the
`qemu-system-*` binary, not the library Velxio loads.

**Simulation starts but the board boots into "qemu: fatal: Trying to
execute code outside RAM or ROM"** — wrong commit. `lcgamboa/qemu`
master moves; Velxio is pinned. Check out the commit listed in
`Dockerfile.standalone`.

## License notes

`lcgamboa/qemu` is **GPL-2.0** (same as upstream QEMU). Velxio is
**AGPLv3**. The dlopen boundary keeps the two licenses orthogonal:
QEMU stays GPL'd, Velxio stays AGPL'd, neither contaminates the other.
If you distribute a modified Velxio image with self-built QEMU
binaries, you owe the QEMU sources to your recipients (GPL-2.0
obligation), and you owe the Velxio modifications under AGPLv3 if
the deployment is networked.

## Why use the prebuilts at all?

For ~99% of self-hosters the prebuilts at
[`velxio.dev/license/signup`](https://velxio.dev/license/signup)
or the GitHub release are the path of least resistance — they're
the same files this guide produces, signed-by-sha256 in their
manifest, ready to drop in. The build itself takes 15-30 minutes
on a modern laptop and ~3 GB of disk for the build tree.

Building from source matters when:

- You're auditing the supply chain for a regulated deployment.
- You need to patch QEMU (e.g. add a peripheral the fork doesn't
  emulate) and want to ship the patched library.
- You don't want any third-party prebuilts on your machine.
- You're on a platform we don't ship a binary for (e.g. BSD, ARM
  on macOS Intel boxes, exotic libc).

All four are legitimate. The license module on velxio.dev exists to
distribute prebuilts conveniently and to detect bulk-abuse patterns;
it never tries to be the only path.
