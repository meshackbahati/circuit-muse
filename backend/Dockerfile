FROM python:3.12-slim

# Install system dependencies, arduino-cli, and wasi-sdk (for custom-chip
# compilation). WASI-SDK bundles clang + wasi-libc and is Apache-2.0 licensed.
ARG WASI_SDK_VERSION=22
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    xz-utils \
    ca-certificates \
    && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh \
    && mv bin/arduino-cli /usr/local/bin/ \
    && rm -rf bin \
    && curl -fL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-linux.tar.gz \
       | tar -xz -C /opt \
    && mv /opt/wasi-sdk-${WASI_SDK_VERSION}.0 /opt/wasi-sdk \
    && apt-get purge -y curl xz-utils \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV WASI_SDK=/opt/wasi-sdk

# Initialize arduino-cli and install cores.
# - arduino:avr  → Uno / Nano / Mega / etc. (built-in core, always needed)
# - ATTinyCore:avr@1.4.1 → ATtiny85 (Spence Konde's third-party core,
#   drazzy.com index). Pinned to 1.4.1 because >=1.5.0 depends on
#   micronucleus hosted at azduino.com (frequently unreachable). 1.4.1's
#   micronucleus tool comes from github.com/digistump and still supports
#   the FQBN clock options we ship (clock=16pll, etc.). We never invoke
#   micronucleus — it is only required for USB upload, not compilation —
#   but arduino-cli will not install a core whose tool deps cannot fetch.
RUN arduino-cli config init \
    && arduino-cli config add board_manager.additional_urls \
        http://drazzy.com/package_drazzy.com_index.json \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr \
    && arduino-cli core install ATTinyCore:avr@1.4.1

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (includes sdk/velxio-chip.h for chip_compile_service)
COPY . .

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
