# Changelog

All notable changes to the **Velxio Simulator** VS Code extension are
documented here.

## 0.2.0

### Breaking

- A **Velxio Pro subscription is now required** to compile or run a
  sketch from inside VS Code. A free **30-day trial** is included and
  starts the first time you sign in. Anonymous compile/run is no longer
  supported — the extension is gated against the license backend on
  every command.

### Added

- `Velxio: Sign In` command — opens `https://velxio.dev/auth/vscode` in
  your browser. After signing in (or creating an account), the page
  hands a license token back to VS Code via the
  `vscode://velxio.velxio-simulator/auth` URI scheme.
- `Velxio: Paste License Key` command — alternative for headless setups
  or shared machines. Keys live in `ExtensionContext.secrets` (OS
  keychain), never in `settings.json`.
- `Velxio: Sign Out` command — clears the stored key.
- `Velxio: Show License Status` command — displays the current plan,
  trial countdown, and renewal date.
- Status bar item next to the board picker shows the current license
  state: `Velxio: Sign in`, `Velxio: Trial Nd`, `Velxio: Pro`, or
  `Velxio: Trial ended` (with the status bar warning/error background
  colour applied automatically).
- New setting `velxio.licenseApiBase` (default `https://velxio.dev`)
  for staging/dev overrides. Leave at the default for production.

### Internal

- New `LicenseService` (`src/LicenseService.ts`) encapsulates secret
  storage, the deep-link nonce flow, validation against
  `/api/pro/license/validate`, and a 60-second in-memory cache so a
  tight compile/run loop doesn't hammer the endpoint.
- The extension is **online-only** by design — validation throws on
  network failure rather than caching a permission grant locally.

### Notes

- Self-hosted Velxio backends do not expose `/api/pro/license/*`. The
  VS Code extension is a velxio.dev product and validates exclusively
  against `https://velxio.dev`. Override `velxio.licenseApiBase` only
  if you are a Velxio developer testing against staging.

## 0.1.0

Initial release. Compile + simulate Arduino / RP2040 / ESP32 sketches
locally from inside VS Code, no auth required.
