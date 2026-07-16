# Velxio Desktop App

Native desktop build of the Velxio simulator — same React frontend, wrapped in a Tauri shell, with the QEMU binaries bundled in. Targets Windows, macOS, and Linux.

> The desktop app is a **Pro** feature (30-day free trial). The OSS web build remains free at velxio.dev and via Docker self-host.

---

## What you get

- **Offline-capable** — the simulator keeps running with no internet. License is validated on launch with a grace period if the network is down.
- **Bundled QEMU** — `libqemu-xtensa`, `libqemu-riscv32`, and `qemu-system-aarch64` ship inside the app, so ESP32 and Raspberry Pi boards work without Docker.
- **Native menus and file system** — open `.vlx` projects from the filesystem, save without browser download prompts.
- **Local compile** — `arduino-cli`, ESP-IDF, and the custom-chip toolchain are managed by the app, with progress shown in a native panel.
- **Single-process** — frontend, backend, QEMU all in one Tauri runtime — no Docker, no localhost dance.

---

## Install

Download the installer for your platform from [velxio.dev/download](https://velxio.dev/download):

- **Windows** — `Velxio-Setup-{version}.exe` (signed)
- **macOS** — `Velxio-{version}.dmg` (notarized)
- **Linux** — `Velxio-{version}.AppImage` and `velxio_{version}_amd64.deb`

First launch downloads the toolchains it needs (~200 MB for AVR + RP2040, plus ~700 MB for ESP-IDF if you select ESP32 boards). All caches live under the OS app-data dir:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\velxio\` |
| macOS | `~/Library/Application Support/velxio/` |
| Linux | `~/.local/share/velxio/` |

---

## License flow

The desktop app uses `vlx_pro_*` / `vlx_trial_*` keys issued by velxio.dev.

### Sign in (browser deep-link)

1. Launch the desktop app.
2. **Welcome screen** appears (the editor is hidden behind it until authorised).
3. Click **Sign in with Velxio**.
4. Your default browser opens `https://velxio.dev/auth/desktop`.
5. Sign in (or create an account) and click **Authorise Velxio Desktop**.
6. The page hands a license token back via the `velxio-desktop://auth?token=…` deep-link scheme.
7. Editor appears.

### Paste a license key manually

If your browser blocks the custom-URL scheme (some Linux distros, corporate proxies), click **Paste key** on the welcome screen and enter the `vlx_pro_*` or `vlx_trial_*` string from [Account → My licenses](https://velxio.dev/account/licenses).

### Offline grace period

Once authorised, the desktop app caches the validated key + entitlements on disk (encrypted via the OS keychain on Windows/macOS, plain file on Linux). On launch:

- **Online + valid** — proceeds normally.
- **Offline + cached key still in grace window** — a **GraceBanner** appears at the top reading "Working offline — re-validate by *date*". The editor stays usable.
- **Offline + grace window expired OR explicit invalidation** — welcome screen comes back; the editor stays hidden until re-validation succeeds.

Grace window length and revalidation cadence are set by the license server response (typically 14 days).

---

## ESP32 QEMU prompt

The first time you select an ESP32-family board on the canvas, a side panel asks you to confirm the bundled QEMU shared library was extracted successfully. If extraction failed (antivirus quarantine, missing VC++ redistributable on Windows), the panel offers a manual download link and a "Retry" button.

Once QEMU is in place, the prompt does not appear again unless the cached binary is removed.

---

## Storage layout

```text
%APPDATA%/velxio/ (Windows) or ~/Library/Application Support/velxio/ (macOS)
+- arduino-cli/         arduino-cli binary + index
+- arduino-data/        installed cores (avr, rp2040, esp32, ATTinyCore)
+- esp-idf/             ESP-IDF toolchain (~700 MB, optional)
+- qemu/                libqemu-xtensa, libqemu-riscv32, qemu-system-aarch64
+- ccache/              C/C++ object cache
+- build/               persistent ESP-IDF build dirs (per target)
+- vlx-files/           user-saved projects
+- license.json         cached license payload + expiry
+- logs/                rotating log files (last 7 days)
```

Everything outside `vlx-files/` is regeneratable — you can delete the whole folder and reinstall; first launch will refetch.

---

## Tauri bridge

The renderer (React) talks to the native shell through `frontend/src/desktop/tauriBridge.ts`. The Tauri commands shipped:

| Command | Purpose |
|---------|---------|
| `license_get_key` | Read the cached license key from disk |
| `license_validate` | POST it to `https://velxio.dev/api/pro/license/validate` |
| `license_clear` | Wipe the cached key (Sign Out) |
| `qemu_check` | Verify the bundled libqemu binaries exist + are executable |
| `qemu_extract` | Re-extract the bundled binaries into the cache dir |
| `open_external` | `open` / `xdg-open` / `start` for the docs button |
| `pick_file` | OS file picker for `.vlx` import |
| `save_file` | OS save dialog for `.vlx` export |

The render-side mounts only when `VITE_DESKTOP` is set at build time, so the OSS web bundle never ships these symbols.

---

## Build from source

The desktop shell is not in this repo (it lives in the closed Tauri build). The renderer code at `frontend/src/desktop/` is what mounts on top of the regular SPA when `VITE_DESKTOP=true`.

If you want to build your own Tauri shell against the OSS frontend, the minimum requirements are:

1. A Tauri 2.x project that loads the production-built `frontend/dist` as its WebView source.
2. Implement the commands listed under "Tauri bridge" above.
3. Bundle `arduino-cli` and `libqemu-*` for your target platforms.
4. Set `VITE_DESKTOP=1` when running `npm run build` in `frontend/`.

The OSS license still applies to the React side. You provide your own Tauri Rust code and your own license server (the official one is gated to legitimate Pro subscriptions).

---

## Pricing

- **Free trial** — 30 days, full Pro features, no credit card.
- **Pro $15/mo** — desktop app + premium components on velxio.dev.
- **Pro Max $35/mo** — everything in Pro plus the in-app AI assistant and priority simulation queue.

Manage your subscription at [velxio.dev/billing](https://velxio.dev/billing).

---

## Troubleshooting

- **Welcome screen won't close after sign-in** — the deep-link handler didn't fire. Click **Paste key** instead and use the key from [Account → My licenses](https://velxio.dev/account/licenses).
- **"libqemu missing" error on ESP32 boards** — the prompt to re-extract appears automatically. If it fails, antivirus likely quarantined the file; whitelist `%APPDATA%\velxio\qemu\` (Windows) or the equivalent on your OS.
- **Grace banner says "expired"** — connect to the internet briefly and the next launch will re-validate.
- **Logs** — `~/.local/share/velxio/logs/` (or equivalent). Attach the latest file when filing a bug report.

---

## See also

- [Getting Started](./getting-started.md) — Hosted, Docker, manual options
- [Emulator Architecture](./emulator.md) — How each CPU backend works
