/**
 * Pro microSD upload-gate registry.
 *
 * Uploading files to the microSD card (the "SD Card" panel) is a paid feature
 * (any paid plan: Maker or above) — mirrors Wokwi. The OSS app owns the panel
 * UI but does NOT know the user's entitlement; the pro overlay installs the
 * real gate (paid-subscriber check) via `installSdCardUploadGate`.
 *
 * Mirrors the other OSS->Pro seams (`proBoardGate.ts`, `proSaveAction.ts`):
 *   - OSS without an overlay -> default 'allow' (self-host has no accounts).
 *   - With the pro overlay   -> the impl returns false for non-paid users on
 *     the web, and the caller fires the upgrade prompt.
 *
 * Note: this gates the UPLOAD only. Placing the component and the free
 * auto-copy of project files are always allowed.
 */

let _impl: (() => boolean) | null = null;

/** Installed by the pro overlay (mountPro). Pass null to clear (hot reload). */
export function installSdCardUploadGate(impl: (() => boolean) | null): void {
  _impl = impl;
}

/** Whether the current user may upload files to the microSD card. */
export function sdCardUploadAllowed(): boolean {
  if (!_impl) return true; // OSS self-host: no accounts -> allow
  try {
    return _impl();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[oss] sd-card upload-gate impl threw:', err);
    return true;
  }
}

/**
 * Fire the Pro upgrade prompt. Dispatches the stable CustomEvent the pro
 * overlay's UpgradeGate listens for — the OSS app never imports from the
 * overlay, only the event name is the contract.
 */
export function triggerSdCardUpgradePrompt(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('velxio-pro-upgrade-prompt', {
      detail: { componentName: 'microSD file upload' },
    }),
  );
}
