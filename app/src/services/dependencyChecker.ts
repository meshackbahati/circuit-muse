/**
 * Dependency checker — detects what's installed and what's missing.
 * Guides users through installation of all required components.
 */

import { isTauri, invoke } from '../desktop/tauriBridge';
import { getApiBase } from '../lib/apiBase';
import { detectEnginePort, getEngineUrl } from './engineConfig';

export type DependencyStatus = 'installed' | 'missing' | 'partial' | 'unknown';

export interface Dependency {
  id: string;
  name: string;
  description: string;
  required: boolean;
  status: DependencyStatus;
  installCommand?: string;
  installUrl?: string;
  notes?: string;
}

// ─── Check Backend Status ─────────────────────────────────────────────────

async function checkBackendCompileStatus(): Promise<{ arduinoCli: boolean; espIdf: boolean }> {
  try {
    const resp = await fetch(`${getApiBase()}/compile/setup-status`);
    if (!resp.ok) return { arduinoCli: false, espIdf: false };
    const data = await resp.json();
    return {
      arduinoCli: data.cli_available ?? false,
      espIdf: data.espidf_available ?? false,
    };
  } catch {
    return { arduinoCli: false, espIdf: false };
  }
}

// ─── Check Tauri QEMU Status ─────────────────────────────────────────────

async function checkQemuStatus(arch: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const cmd = arch === 'esp32' ? 'esp32_qemu_status' : 'stm32_qemu_status';
    const status = await invoke<{ installed: boolean }>(cmd);
    return status.installed;
  } catch {
    return false;
  }
}

// ─── Check Chip Compile Status ───────────────────────────────────────────

async function checkChipCompileStatus(): Promise<boolean> {
  try {
    const resp = await fetch(`${getApiBase()}/compile-chip/status`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.available ?? false;
  } catch {
    return false;
  }
}

// ─── Full Dependency Scan ─────────────────────────────────────────────────

export async function scanDependencies(): Promise<Dependency[]> {
  const deps: Dependency[] = [];

  // Backend connectivity
  let backendOnline = false;
  if (isTauri()) {
    // The engine can report ready just before its HTTP server starts accepting
    // requests; discover the active port instead of trusting a stale saved one.
    await detectEnginePort();
  }
  try {
    const healthUrl = isTauri() ? `${getEngineUrl()}/health` : '/health';
    const resp = await fetch(healthUrl);
    backendOnline = resp.ok;
  } catch { /* */ }

  deps.push({
    id: 'backend',
    name: 'Backend Server',
    description: 'FastAPI backend for compilation and simulation',
    required: true,
    status: backendOnline ? 'installed' : 'missing',
    installCommand: isTauri() ? undefined : 'cd engine && pip install -r requirements.txt && python __main__.py',
    notes: backendOnline
      ? `Running on port ${new URL(isTauri() ? getEngineUrl() : 'http://localhost:8001').port || '8001'}`
      : isTauri()
        ? 'The bundled engine is not responding. Restart the app and re-scan.'
        : 'Start the local engine with: python __main__.py',
  });

  // Arduino CLI
  if (backendOnline) {
    const { arduinoCli } = await checkBackendCompileStatus();
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent);
    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
    let osNotes = 'Install from arduino.github.io/arduino-cli/installation/';
    if (!arduinoCli) {
      if (isWindows) {
        osNotes = 'Windows: Run "winget install Arduino.ArduinoCLI" in terminal, or download from arduino-cli website.';
      } else if (isMac) {
        osNotes = 'macOS: Run "brew install arduino-cli" in terminal.';
      } else {
        osNotes = 'Linux: Run "sudo apt install arduino-cli" or "snap install arduino-cli", or use the curl install script.';
      }
    }
    deps.push({
      id: 'arduino-cli',
      name: 'Arduino CLI',
      description: 'Compiles Arduino AVR, RP2040, and ESP32 sketches',
      required: true,
      status: arduinoCli ? 'installed' : 'missing',
      installUrl: 'https://arduino.github.io/arduino-cli/latest/installation/',
      notes: arduinoCli
        ? 'Arduino cores auto-install on first compile'
        : osNotes,
    });
  }

  // ESP-IDF (optional, for ESP32 QEMU builds)
  if (backendOnline) {
    const { espIdf } = await checkBackendCompileStatus();
    deps.push({
      id: 'esp-idf',
      name: 'ESP-IDF Toolchain',
      description: 'Required for ESP32 QEMU-compatible firmware builds',
      required: false,
      status: espIdf ? 'installed' : 'missing',
      installUrl: 'https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/get-started/',
      notes: espIdf
        ? 'ESP-IDF v4.4.7 detected'
        : 'Not needed for most projects: ESP32 boards compile with Arduino CLI. ESP-IDF is a large manual install (about 1.5 GB with git and Python), so it is not installed automatically.',
    });
  }

  // ESP32 QEMU runtime
  const esp32Qemu = await checkQemuStatus('esp32');
  deps.push({
    id: 'qemu-esp32',
    name: 'ESP32 QEMU Runtime',
    description: 'Emulator for ESP32 and ESP32-S3 boards',
    required: false,
    status: esp32Qemu ? 'installed' : 'missing',
    notes: esp32Qemu ? 'ESP32 QEMU detected' : 'Click Install to download it (about 15 MB).',
  });

  // STM32 QEMU runtime
  const stm32Qemu = await checkQemuStatus('stm32');
  deps.push({
    id: 'qemu-stm32',
    name: 'STM32 QEMU Runtime',
    description: 'Emulator for STM32 boards',
    required: false,
    status: stm32Qemu ? 'installed' : 'missing',
    notes: stm32Qemu
      ? 'libqemu-arm detected'
      : 'Automatic install is not available for STM32 in this build.',
  });

  // Custom chip compile (wasi-sdk). The desktop app can install it; the
  // engine re-checks on each status call, so no restart is needed.
  if (backendOnline || isTauri()) {
    const chipCompile = backendOnline ? await checkChipCompileStatus() : false;
    const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
    deps.push({
      id: 'wasi-sdk',
      name: 'WASI SDK',
      description: 'Compiles custom chip C code to WebAssembly',
      required: false,
      status: chipCompile ? 'installed' : 'missing',
      installUrl: 'https://github.com/WebAssembly/wasi-sdk/releases',
      notes: chipCompile
        ? 'wasi-sdk detected'
        : isTauri()
          ? `Only needed for custom chips. Click Install to download it (about ${isWindows ? '620' : '190'} MB).`
          : 'Only needed for custom chips.',
    });
  }

  return deps;
}

// ─── Auto-install QEMU from Tauri ────────────────────────────────────────

export interface QemuInstallProgress {
  progress: number;
  phase: string;
  bytesDownloaded?: number;
  totalBytes?: number;
}

/** Tools the desktop app can download and install by itself, with the Tauri
 *  command and the progress event each one uses. */
const INSTALLERS: Record<string, { command: string; event: string }> = {
  'qemu-esp32': { command: 'esp32_qemu_install', event: 'esp32-qemu-progress' },
  'wasi-sdk': { command: 'wasi_sdk_install', event: 'wasi-sdk-progress' },
};

export function canAutoInstall(depId: string): boolean {
  // STM32 needs libqemu-arm, which the open-source build does not ship, and
  // ESP-IDF is a multi-step toolchain install.
  return isTauri() && depId in INSTALLERS;
}

export async function autoInstallTool(
  depId: string,
  onProgress?: (detail: QemuInstallProgress) => void,
): Promise<void> {
  if (!isTauri()) throw new Error('Automatic install needs the desktop app.');
  const installer = INSTALLERS[depId];
  if (!installer) throw new Error(`No automatic installer for ${depId}.`);

  const { listen } = await import('../desktop/tauriBridge');
  const unsub = await listen<{
    progress?: number;
    phase: string;
    bytes_downloaded?: number;
    total_bytes?: number;
  }>(installer.event, (event) => {
    const payload = event.payload;
    onProgress?.({
      progress: payload.progress ?? 0,
      phase: payload.phase,
      bytesDownloaded: payload.bytes_downloaded,
      totalBytes: payload.total_bytes,
    });
  });

  try {
    await invoke(installer.command);
  } finally {
    unsub();
  }
}
