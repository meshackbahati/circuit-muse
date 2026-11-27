/**
 * Dependency checker — detects what's installed and what's missing.
 * Guides users through installation of all required components.
 */

import { isTauri, invoke } from '../desktop/tauriBridge';
import { getApiBase } from '../lib/apiBase';
import { detectEnginePort, getEngineUrl } from './engineConfig';

export type DependencyStatus = 'installed' | 'missing' | 'partial' | 'unknown';
export type HostOS = 'windows' | 'macos' | 'linux' | 'unknown';

/** Detect the host operating system so setup can show the matching commands. */
export function hostPlatform(): { os: HostOS; label: string; arch: string } {
  if (typeof navigator === 'undefined') return { os: 'unknown', label: 'Unknown system', arch: '' };
  const ua = navigator.userAgent;
  const platform = (navigator as { platform?: string }).platform ?? '';
  const arch = /arm64|aarch64/i.test(ua + platform)
    ? 'arm64'
    : /x86_64|x64|win64/i.test(ua + platform)
      ? 'x64'
      : '';
  if (/win/i.test(ua) || /win/i.test(platform)) return { os: 'windows', label: 'Windows', arch };
  if (/mac/i.test(ua) || /mac/i.test(platform)) return { os: 'macos', label: 'macOS', arch };
  if (/linux/i.test(ua) || /linux/i.test(platform)) return { os: 'linux', label: 'Linux', arch };
  return { os: 'unknown', label: 'Unknown system', arch };
}

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
  const host = hostPlatform();

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
        ? `${host.label}: the bundled engine is not responding. Restart the app and re-scan.`
        : `${host.label}: start the local engine with python __main__.py inside engine/.`,
  });

  // Arduino CLI
  if (backendOnline) {
    const { arduinoCli } = await checkBackendCompileStatus();
    const arduinoCommand =
      host.os === 'windows' ? 'winget install Arduino.ArduinoCLI' :
      host.os === 'macos' ? 'brew install arduino-cli' :
      host.os === 'linux' ? 'sudo apt install arduino-cli' : '';
    const osNotes = arduinoCli
      ? `${host.label}: Arduino cores auto-install on first compile.`
      : arduinoCommand
        ? `${host.label}: run ${arduinoCommand} in a terminal, or use the install guide.`
        : `${host.label}: use the install guide for Arduino CLI.`;
    deps.push({
      id: 'arduino-cli',
      name: 'Arduino CLI',
      description: 'Compiles Arduino AVR, RP2040, and ESP32 sketches',
      required: true,
      status: arduinoCli ? 'installed' : 'missing',
      installUrl: 'https://arduino.github.io/arduino-cli/latest/installation/',
      installCommand: arduinoCli ? undefined : arduinoCommand || undefined,
      notes: osNotes,
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
        ? `${host.label}: ESP-IDF v4.4.7 detected`
        : `${host.label}: not needed for most projects, since ESP32 boards compile with Arduino CLI. ESP-IDF is a manual install of about 1.5 GB with git and Python, so the wizard does not download it.`,
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
    notes: esp32Qemu
      ? `${host.label}: ESP32 QEMU detected`
      : `${host.label}: click Install to download the matching build (about 15 MB).`,
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
      ? `${host.label}: QEMU Arm runtime detected`
      : `${host.label}: click Install to download the matching QEMU Arm build (about 35 MB).`,
  });

  // Custom chip compile (wasi-sdk). The desktop app can install it; the
  // engine re-checks on each status call, so no restart is needed.
  if (backendOnline || isTauri()) {
    const chipCompile = backendOnline ? await checkChipCompileStatus() : false;
    deps.push({
      id: 'wasi-sdk',
      name: 'WASI SDK',
      description: 'Compiles custom chip C code to WebAssembly',
      required: false,
      status: chipCompile ? 'installed' : 'missing',
      installUrl: 'https://github.com/WebAssembly/wasi-sdk/releases',
      notes: chipCompile
        ? `${host.label}: wasi-sdk detected`
        : isTauri()
          ? `${host.label}: only needed for custom chips. Click Install to download the matching build (about ${host.os === 'windows' ? '620' : '190'} MB).`
          : `${host.label}: only needed for custom chips.`,
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
  'qemu-stm32': { command: 'stm32_qemu_install', event: 'stm32-qemu-progress' },
  'wasi-sdk': { command: 'wasi_sdk_install', event: 'wasi-sdk-progress' },
};

export function canAutoInstall(depId: string): boolean {
  // ESP-IDF is a multi-step toolchain install and remains manual.
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
