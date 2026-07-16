# Getting Started

Velxio is an open-source multi-board emulator and electronics simulator. There are four ways to use it:

1. **[Hosted (web)](#option-1-use-the-hosted-version)** — open velxio.dev, no install.
2. **[Self-host with Docker](#option-2-self-host-with-docker)** — one container, all 19 boards including ESP32 (Xtensa) and Raspberry Pi 3.
3. **[Manual setup](#option-3-manual-setup-development)** — frontend + backend separately, for development.
4. **[Desktop app](#option-4-desktop-app-tauri)** — native Tauri app for offline work (Pro).

---

## Option 1: Use the Hosted Version

Open the live editor at [velxio.dev](https://velxio.dev) — no install needed.

The hosted edition includes everything in OSS plus accounts, public profiles at `/:username`, persistent project URLs, and the Pro features (custom-chip cloud build, premium components, AI assistant on Pro Max). Free tier is fully usable for digital simulation; analog and a few advanced features sit behind Pro.

---

## Option 2: Self-Host with Docker

One container, all 19 boards (AVR, RP2040, RISC-V, **ESP32 Xtensa**, **Raspberry Pi 3**):

```bash
docker run -d \
  --name velxio \
  -p 3080:80 \
  -v velxio-data:/app/data \
  -v velxio-arduino-libs:/root/.arduino15 \
  -v velxio-arduino-user-libs:/root/Arduino \
  -v velxio-ccache:/var/cache/ccache \
  -v velxio-build:/var/lib/velxio-build \
  ghcr.io/davidmonterocrespo24/velxio:master
```

Open the simulator at <http://localhost:3080>.

The named volumes are what make compile times reasonable on subsequent runs — without them every container restart wipes the ESP-IDF build cache and the first compile after each restart takes 5–7 minutes instead of 5–30 seconds.

| Volume | Mount | Purpose |
|--------|-------|---------|
| `velxio-data` | `/app/data` | SQLite (if Pro overlay is layered), sketch files |
| `velxio-arduino-libs` | `/root/.arduino15` | arduino-cli config + installed cores |
| `velxio-arduino-user-libs` | `/root/Arduino` | Library Manager downloads |
| `velxio-ccache` | `/var/cache/ccache` | ccache for ESP-IDF compiles |
| `velxio-build` | `/var/lib/velxio-build` | Persistent ESP-IDF build dirs (per target) |

### Docker Compose (build from source)

```bash
git clone https://github.com/davidmonterocrespo24/velxio.git
cd velxio
docker compose up -d --build
```

First build takes ~10–15 min (downloads ESP-IDF, builds the frontend). Subsequent builds use Docker cache and finish in ~1 min.

---

## Option 3: Manual Setup (Development)

**Prerequisites:** Node.js 18+, Python 3.12+, `arduino-cli`

Manual installs get the browser-side boards (AVR, RP2040, RISC-V TypeScript ISA) out of the box. ESP32 (Xtensa) and Raspberry Pi 3 need QEMU `.so` libraries that ship inside the Docker image — see [BUILD-QEMU.md](./BUILD-QEMU.md) if you want them locally.

### 1. Clone the repository

```bash
git clone https://github.com/davidmonterocrespo24/velxio.git
cd velxio
```

No `--recurse-submodules` needed. `@wokwi/elements`, `avr8js` and `rp2040js` come from npm. The folders under `third-party/` are reference-only.

### 2. Start the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

### 3. Start the frontend

```bash
# In a new terminal:
cd frontend
npm install
npm run dev
```

Open the dev server at <http://localhost:5173>.

### 4. Set up arduino-cli cores (first time)

```bash
arduino-cli core update-index
arduino-cli core install arduino:avr

# For Raspberry Pi Pico / Pico W:
arduino-cli config add board_manager.additional_urls \
  https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
arduino-cli core install rp2040:rp2040

# For ATtiny85:
arduino-cli config add board_manager.additional_urls \
  http://drazzy.com/package_drazzy.com_index.json
arduino-cli core install ATTinyCore:avr

# For ESP32 / ESP32-S3 / ESP32-C3 (Arduino core 2.0.17 — the only version
# compatible with the lcgamboa WiFi shim):
arduino-cli config add board_manager.additional_urls \
  https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@2.0.17
```

---

## Option 4: Desktop App (Tauri)

The Velxio Desktop app is a native build (Tauri + the same React frontend) for offline work. Requires a Pro subscription; ships with a 30-day free trial.

- **Offline-capable** — the simulator keeps running even with no internet. License is validated on launch with a grace period if the network is down.
- **No browser tab** — runs in its own window with native menus and file-system access.
- **Bundled QEMU** — ships with the libqemu binaries on Windows / macOS / Linux, so ESP32 and Pi boards work without Docker.

Download from [velxio.dev/download](https://velxio.dev/download). See [docs/desktop-app.md](./desktop-app.md) for install paths, license flow, and the offline grace banner.

---

## Your First Simulation

1. **Open the editor** at [velxio.dev/editor](https://velxio.dev/editor) or your local instance.
1. **Select a board** from the toolbar (e.g., *Arduino Uno*, *ESP32 DevKit*, *Pi Pico*, *Pi 3B*).
1. **Write code** in the Monaco editor — Arduino C++ on every board, or MicroPython on Pico / ESP32 family, or Python 3 on Raspberry Pi.

```cpp
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
```

1. **Click Compile** — the backend calls `arduino-cli` (or ESP-IDF, or rp2040 toolchain) and returns a `.hex` / `.bin` / `.uf2`.
1. **Click Run** — the simulator executes.
1. **Add components** — click the **+** button on the canvas, pick from 590+ components in the picker (search by name or category).
1. **Connect wires** — click a pin to start, click another pin to finish.

---

## Trying analog circuits

1. Add a **Power Supply (5V)**, a **Resistor**, and a **Voltmeter** from the picker.
2. Wire the supply to the resistor, the resistor to a ground rail, and the voltmeter across the resistor.
3. The voltmeter shows the steady-state voltage in real time — no MCU code needed.
4. Add an **Op-Amp** or **Transistor** and the ngspice engine solves the netlist every frame.
5. Drop an **Oscilloscope** on the canvas, attach probes, and watch waveforms.

See the [Electrical Simulation User Guide](./wiki/electrical-simulation-user-guide.md) for the full analog workflow.

---

## Loading an Example Project

380+ examples ship in the gallery, organized into:

- **Basics / 100 Days of Code** — Blink, traffic light, button-LED, fade, RGB, Simon Says, LCDs…
- **Circuits** — pure analog (filters, dividers, RC, op-amp configurations, transistor amps)
- **Analog** & **Digital** — labelled by signal type
- **E-Paper Displays** — Waveshare-style panels
- **Pico W WiFi** — networking demos on the Pico W
- **Retro Intel/Zilog** — 4004, 4040, 8080, 8086, Z80 driving 7-segments and shift registers

Click **Examples** in the nav bar, filter by board or category, and click **Load**.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `arduino-cli: command not found` | Install `arduino-cli` and add it to your PATH. |
| LED doesn't blink | Open the component property dialog and verify the Arduino pin assignment. Check the browser console for port-listener errors. |
| Serial Monitor is empty | Ensure `Serial.begin()` is called inside `setup()`. |
| Compilation errors | Open the compilation console at the bottom of the editor for full toolchain output. |
| ESP32 fails to boot | Use `esp32:esp32@2.0.17` (the only version compatible with the lcgamboa WiFi shim). Check `libqemu-xtensa.{dll,so,dylib}` is present in `backend/app/services/`. |
| Pi 3 takes 5+ seconds to start | Expected — QEMU boots a full Raspberry Pi OS. The "booting" status is normal. |
| Analog probe reads 0 V | Make sure both ends of the wire actually land on a pin (the wire turns blue when valid). Re-check ground connections. |
| Custom chip won't compile | The custom-chip toolchain ships in the Docker image. For manual setups, see [Custom Chips: Build & Test](./wiki/custom-chips-build-and-test.md). |

---

## Community & Links

- **GitHub:** [github.com/davidmonterocrespo24/velxio](https://github.com/davidmonterocrespo24/velxio)
- **Discord:** [discord.gg/3mARjJrh4E](https://discord.gg/3mARjJrh4E)
- **Live demo:** [velxio.dev](https://velxio.dev)
- **Sponsor:** [github.com/sponsors/davidmonterocrespo24](https://github.com/sponsors/davidmonterocrespo24)

---

## Next steps

- [Components Reference](./components.md) — All 590+ components
- [Example Projects](./examples/README.md) — Built-in gallery
- [Emulator Architecture](./emulator.md) — How each backend (AVR / RP2040 / Xtensa / RISC-V / ARM) works
- [Electrical Simulation Guide](./wiki/electrical-simulation-user-guide.md) — Analog and mixed-signal
- [Custom Chips Guide](./CUSTOM_CHIPS.md) — Write chips in C
- [Roadmap](./roadmap.md) — What's next
