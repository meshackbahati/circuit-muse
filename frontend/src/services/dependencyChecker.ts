/**
 * Dependency checker — detects what's installed and what's missing.
 * Guides users through installation of all required components.
 */

import { isTauri, invoke } from '../desktop/tauriBridge';

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
    const resp = await fetch('/api/compile/setup-status');
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
    const resp = await fetch('/api/compile-chip/status');
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
  try {
    const resp = await fetch('/health');
    backendOnline = resp.ok;
  } catch { /* */ }

  deps.push({
    id: 'backend',
    name: 'Backend Server',
    description: 'FastAPI backend for compilation and simulation',
    required: true,
    status: backendOnline ? 'installed' : 'missing',
    installCommand: 'cd backend && pip install -r requirements.txt && uvicorn app.main:app --port 8001',
    notes: backendOnline ? 'Running on port 8001' : 'Start with: uvicorn app.main:app --port 8001',
  });

  // Arduino CLI
  if (backendOnline) {
    const { arduinoCli } = await checkBackendCompileStatus();
    deps.push({
      id: 'arduino-cli',
      name: 'Arduino CLI',
      description: 'Compiles Arduino AVR, RP2040, and ESP32 sketches',
      required: true,
      status: arduinoCli ? 'installed' : 'missing',
      installUrl: 'https://arduino.github.io/arduino-cli/installation/',
      notes: arduinoCli
        ? 'Arduino cores auto-install on first compile'
        : 'Install from arduino.github.io/arduino-cli/installation/',
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
      notes: espIdf ? 'ESP-IDF v4.4.7 detected' : 'Optional — ESP32 boards work via arduino-cli without it',
    });
  }

  // ESP32 QEMU runtime
  const esp32Qemu = await checkQemuStatus('esp32');
  deps.push({
    id: 'qemu-esp32',
    name: 'ESP32 QEMU Runtime',
    description: 'Shared library for ESP32/ESP32-S3 simulation (~42 MB)',
    required: false,
    status: esp32Qemu ? 'installed' : 'missing',
    notes: esp32Qemu ? 'libqemu-xtensa detected' : 'Download via the ESP32 board prompt or install manually',
  });

  // STM32 QEMU runtime
  const stm32Qemu = await checkQemuStatus('stm32');
  deps.push({
    id: 'qemu-stm32',
    name: 'STM32 QEMU Runtime',
    description: 'Shared library for STM32 simulation (~30 MB)',
    required: false,
    status: stm32Qemu ? 'installed' : 'missing',
    notes: stm32Qemu ? 'libqemu-arm detected' : 'Download via the STM32 board prompt or install manually',
  });

  // Custom chip compile (wasi-sdk)
  if (backendOnline) {
    const chipCompile = await checkChipCompileStatus();
    deps.push({
      id: 'wasi-sdk',
      name: 'WASI SDK',
      description: 'Compiles custom chip C code to WebAssembly',
      required: false,
      status: chipCompile ? 'installed' : 'missing',
      installUrl: 'https://github.com/aspect-build/toolchains_llvm/releases',
      notes: chipCompile ? 'wasi-sdk detected' : 'Optional — only needed for custom chip compilation',
    });
  }

  return deps;
}

// ─── Auto-install QEMU from Tauri ────────────────────────────────────────

export async function autoInstallQemu(
  arch: 'esp32' | 'stm32',
  onProgress?: (pct: number, phase: string) => void,
): Promise<boolean> {
  if (!isTauri()) return false;

  const installCmd = arch === 'esp32' ? 'esp32_qemu_install' : 'stm32_qemu_install';
  const progressEvent = arch === 'esp32' ? 'esp32-qemu-progress' : 'stm32-qemu-progress';

  try {
    // Listen for progress
    const { listen } = await import('../desktop/tauriBridge');
    const unsub = await listen<{ progress: number; phase: string }>(progressEvent, (event) => {
      onProgress?.(event.payload.progress ?? 0, event.payload.phase);
    });

    await invoke(installCmd);
    unsub();
    return true;
  } catch {
    return false;
  }
}
