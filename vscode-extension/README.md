# Velxio Simulator for VS Code

Local Arduino, RP2040 and ESP32 simulator inside your editor. Compile
your sketch, watch it run in a side-by-side WebView, and stream serial
to the integrated terminal — no board, no USB cable, no separate IDE.

## Requirements

- VS Code 1.85 or newer.
- A **Velxio Pro subscription**. A 30-day free trial is included and
  starts automatically the first time you sign in.
- An internet connection. The extension validates your subscription
  before every compile and run; offline use is not supported in the
  VS Code build. For offline work, use the Velxio Desktop app instead.

## Getting started

1. Install the extension from the marketplace.
2. Open a folder containing `velxio.toml` or `diagram.json` (or
   create one with `Velxio: Open Simulator`).
3. Run **`Velxio: Sign In`** from the command palette. Your browser
   opens `https://velxio.dev/auth/vscode`; sign in (or create an
   account), then click **Authorise VS Code**. The page hands a
   license token back to VS Code via the
   `vscode://velxio.velxio-simulator/auth` URI scheme.
4. The status bar in the bottom-left shows **`Velxio: Trial 30d`** (or
   **`Velxio: Pro`** for paid subscribers). Compile and Run are now
   enabled.

If your browser blocks the deep-link, or if you'd rather paste the key
manually, run **`Velxio: Paste License Key`** and enter the
`vlx_pro_...` / `vlx_trial_...` string from
[Account → My licenses](https://velxio.dev/account/licenses).

## Commands

| Command | Description |
|---|---|
| `Velxio: Open Simulator`     | Open the side-by-side simulator panel. |
| `Velxio: Compile Sketch`     | Build the active project (requires Pro). |
| `Velxio: Run Simulation`     | Compile and start the simulation. |
| `Velxio: Stop Simulation`    | Stop the current simulation. |
| `Velxio: Select Board`       | Pick the target board (Arduino Uno, RP2040, ESP32, …). |
| `Velxio: Sign In`            | Browser-based sign-in via velxio.dev. |
| `Velxio: Paste License Key`  | Paste a key manually. |
| `Velxio: Sign Out`           | Forget the stored key. |
| `Velxio: Show License Status`| Show plan, trial countdown, renewal date. |

## Settings

| Setting | Default | Description |
|---|---|---|
| `velxio.defaultBoard`     | `arduino-uno`         | Board used when none is configured in `velxio.toml`. |
| `velxio.autoStartBackend` | `true`                | Auto-start the local compilation backend when needed. |
| `velxio.backendPort`      | `0`                   | Fixed port for the backend (0 = auto-assign). |
| `velxio.arduinoCliPath`   | `""`                  | Path to `arduino-cli` (leave empty to auto-detect). |
| `velxio.licenseApiBase`   | `https://velxio.dev`  | License validation endpoint. **Override only for development.** |

## Pricing

- **Free trial** — 30 days, full Velxio Pro features, no credit card.
- **Pro $15/mo** — unlocks the VS Code extension, the Velxio Desktop
  app, and the premium components on velxio.dev.
- **Pro Max $35/mo** — everything in Pro plus the in-app AI assistant
  and priority simulation queue.

Manage your subscription at <https://velxio.dev/billing>.

## Troubleshooting

- **`Velxio requires an internet connection`** — the extension cannot
  reach `https://velxio.dev/api/pro/license/validate`. Check your
  network, VPN, and any corporate proxy.
- **`Your trial has ended`** — start a Pro subscription at
  <https://velxio.dev/billing>. Existing trial keys re-activate
  automatically once the subscription is live.
- **Status bar shows `Velxio: Sign in`** — run **`Velxio: Sign In`** or
  **`Velxio: Paste License Key`**.
- **Deep-link doesn't return to VS Code** — some browsers silently
  block custom URL schemes. The page shows an **Open VS Code** button
  as a fallback; click it to retry the deep-link.

## Privacy

The extension sends only your license key + your VS Code version + OS
arch to `https://velxio.dev` for validation. No sketch contents, file
paths, or telemetry leave your machine. See the
[Velxio privacy policy](https://velxio.dev/privacy) for the full
picture.
