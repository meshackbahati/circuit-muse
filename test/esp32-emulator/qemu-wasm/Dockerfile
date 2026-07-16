# Dockerfile to build QEMU for ESP32 with Emscripten
FROM emscripten/emsdk:latest AS builder

WORKDIR /src

# Clone QEMU fork (lcgamboa)
RUN git clone --depth 1 https://github.com/lcgamboa/qemu.git -b picsimlab-esp32 qemu
WORKDIR /src/qemu

# Apply patches if needed (none for now)

# Configure for Emscripten
# Use emconfigure wrapper to set up environment
RUN emconfigure ./configure \
    --target-list=xtensa-softmmu \
    --disable-system \
    --disable-user \
    --disable-tools \
    --disable-docs \
    --disable-guest-agent \
    --disable-slirp \
    --disable-werror \
    --enable-emscripten \
    --extra-cflags="-O2 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1" \
    --cross-prefix=em \
    --cpu=wasm32

# Build with emmake
RUN emmake make -j$(nproc)

# The resulting binary will be qemu-system-xtensa.wasm? Actually QEMU builds to .js and .wasm
# We need to copy the generated files to output directory
RUN mkdir -p /output
RUN cp -r build/* /output/

# Also build the shared library version for easier integration
# (optional)

FROM scratch AS export
COPY --from=builder /output/ /