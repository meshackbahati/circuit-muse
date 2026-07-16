/**
 * Component installation pipeline.
 * Auto-downloads QEMU runtimes, Arduino cores, and libraries.
 */

import { isTauri, invoke, listen } from '../desktop/tauriBridge';

export type InstallStatus = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error';

export interface InstallProgress {
  phase: InstallStatus;
  percent?: number;
  message?: string;
  error?: string;
}

type ProgressCallback = (progress: InstallProgress) => void;

// ─── QEMU Runtime Installer ──────────────────────────────────────────────

export async function installQemuRuntime(
  arch: 'esp32' | 'stm32',
  onProgress?: ProgressCallback,
): Promise<boolean> {
  if (!isTauri()) {
    onProgress?.({ phase: 'error', error: 'QEMU install requires the desktop app' });
    return false;
  }

  const statusCmd = arch === 'esp32' ? 'esp32_qemu_status' : 'stm32_qemu_status';
  const installCmd = arch === 'esp32' ? 'esp32_qemu_install' : 'stm32_qemu_install';
  const progressEvent = arch === 'esp32' ? 'esp32-qemu-progress' : 'stm32-qemu-progress';

  // Check if already installed
  onProgress?.({ phase: 'checking' });
  try {
    const status = await invoke<{ installed: boolean }>(statusCmd);
    if (status.installed) {
      onProgress?.({ phase: 'done' });
      return true;
    }
  } catch {
    // Command not registered — pre-0.3.0 shell
  }

  // Start install
  onProgress?.({ phase: 'downloading', percent: 0 });

  let dispose: (() => void) | null = null;
  try {
    // Listen for progress events
    const unsub = await listen<{ progress: number; phase: string }>(progressEvent, (event) => {
      const { progress, phase } = event.payload;
      if (phase === 'done') {
        onProgress?.({ phase: 'done' });
      } else {
        onProgress?.({
          phase: 'downloading',
          percent: progress,
          message: phase === 'extracting' ? 'Extracting...' : 'Downloading...',
        });
      }
    });
    dispose = unsub;

    await invoke(installCmd);
    onProgress?.({ phase: 'done' });
    return true;
  } catch (err) {
    onProgress?.({ phase: 'error', error: String(err) });
    return false;
  } finally {
    if (dispose) dispose();
  }
}

// ─── Arduino Core Installer ──────────────────────────────────────────────

export async function installArduinoCore(
  coreFqbn: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({ phase: 'installing', message: `Installing ${coreFqbn}...` });

  try {
    const response = await fetch('/api/compile/ensure-core', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ core_fqbn: coreFqbn }),
    });

    if (!response.ok) {
      const text = await response.text();
      onProgress?.({ phase: 'error', error: text });
      return false;
    }

    onProgress?.({ phase: 'done' });
    return true;
  } catch (err) {
    onProgress?.({ phase: 'error', error: String(err) });
    return false;
  }
}

// ─── Library Installer ───────────────────────────────────────────────────

export async function installLibrary(
  name: string,
  version?: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  onProgress?.({ phase: 'installing', message: `Installing library ${name}...` });

  try {
    const response = await fetch('/api/libraries/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, version }),
    });

    if (!response.ok) {
      const text = await response.text();
      onProgress?.({ phase: 'error', error: text });
      return false;
    }

    onProgress?.({ phase: 'done' });
    return true;
  } catch (err) {
    onProgress?.({ phase: 'error', error: String(err) });
    return false;
  }
}

// ─── Auto-detect Missing Dependencies ────────────────────────────────────

export interface MissingDependency {
  type: 'qemu' | 'core' | 'library';
  name: string;
  description: string;
  required: boolean;
}

export function detectMissingDependencies(): MissingDependency[] {
  // This runs on the frontend — we can only detect what's needed,
  // not what's installed on the backend. The backend handles actual
  // installation. We return hints for the UI.
  return [];
}

/**
 * Auto-install all dependencies needed for a given board.
 */
export async function autoInstallForBoard(
  boardKind: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  // ESP32 boards need QEMU runtime
  if (boardKind.startsWith('esp32') || boardKind === 'esp32-c3') {
    const arch = boardKind === 'esp32-c3' ? 'esp32' : 'esp32';
    await installQemuRuntime(arch, onProgress);
  }

  // STM32 boards need QEMU runtime
  if (boardKind.startsWith('stm32')) {
    await installQemuRuntime('stm32', onProgress);
  }

  // All boards need their core installed
  const coreMap: Record<string, string> = {
    'arduino-uno': 'arduino:avr',
    'arduino-nano': 'arduino:avr',
    'arduino-mega': 'arduino:avr',
    'attiny85': 'ATTinyCore:avr',
    'raspberry-pi-pico': 'rp2040:rp2040',
    'pi-pico-w': 'rp2040:rp2040',
    'esp32': 'esp32:esp32',
    'esp32-s3': 'esp32:esp32',
    'esp32-c3': 'esp32:esp32',
    'stm32-bluepill': 'STMicroelectronics:stm32',
    'stm32-nucleo': 'STMicroelectronics:stm32',
  };

  const core = coreMap[boardKind];
  if (core) {
    await installArduinoCore(core, onProgress);
  }
}
