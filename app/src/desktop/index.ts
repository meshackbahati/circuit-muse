/**
 * CircuitMuse Desktop SPA hooks - mounted from main.tsx when VITE_DESKTOP is set.
 *
 * Responsibilities:
 *   1. Install native menu listener for desktop keyboard shortcuts.
 *   2. Mount side panels (ESP32/STM32 QEMU prompts + update toast).
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement as h, Fragment } from 'react';
import { Esp32QemuPrompt } from './Esp32QemuPrompt';
import { Stm32QemuPrompt } from './Stm32QemuPrompt';
import { UpdateAvailableToast } from './UpdateAvailableToast';
import { installDesktopMenuListener } from './menu';
import { dlog } from './log';
import { detectEnginePort } from '../services/engineConfig';
import './desktop.css';

let mounted = false;
let sidePanelRoot: Root | null = null;

function mountSidePanels(): void {
  if (sidePanelRoot) return;
  const host = document.createElement('div');
  host.id = 'circuit-muse-desktop-side-panels';
  document.body.appendChild(host);
  sidePanelRoot = createRoot(host);
  sidePanelRoot.render(
    h(
      Fragment,
      null,
      h(Esp32QemuPrompt, null),
      h(Stm32QemuPrompt, null),
      h(UpdateAvailableToast, null),
    ),
  );
}

export const mountDesktop = (): void => {
  if (mounted) return;
  mounted = true;
  dlog('mountDesktop - Tauri shell active');

  void installDesktopMenuListener();
  mountSidePanels();

  // Auto-detect engine port
  detectEnginePort().then((port) => {
    if (port) {
      dlog(`Engine detected on port ${port}`);
    } else {
      dlog('Engine not detected - will retry on first request');
    }
  });
};
