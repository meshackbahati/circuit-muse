/**
 * CircuitMuse Desktop SPA hooks - mounted from main.tsx when VITE_DESKTOP is set.
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement as h, Fragment } from 'react';
import { Esp32QemuPrompt } from './Esp32QemuPrompt';
import { Stm32QemuPrompt } from './Stm32QemuPrompt';
import { UpdateAvailableToast } from './UpdateAvailableToast';
import { installDesktopMenuListener } from './menu';
import { dlog } from './log';
import { invoke, listen } from './tauriBridge';
import { clearEnginePort, detectEnginePort, setEnginePort } from '../services/engineConfig';
import './desktop.css';

let mounted = false;
let sidePanelRoot: Root | null = null;

function mountSidePanels(): void {
  if (sidePanelRoot) return;
  const host = document.createElement('div');
  host.id = 'cm-desktop-side-panels';
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

function mountStatusBar(): void {
  const bar = document.createElement('div');
  bar.id = 'cm-engine-status';
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:4px 12px;background:#1a1a2e;color:#888;font-size:11px;z-index:9999;display:flex;align-items:center;gap:8px;border-top:1px solid #2c2c33;';
  bar.innerHTML = '<span style="color:#8b5cf6;">&#9679;</span> Starting simulation engine...';
  document.body.appendChild(bar);

  // Auto-detect engine in background — show setup wizard on first launch
  if (!localStorage.getItem('circuit-muse_setup_seen')) {
    // Will be shown by SetupWizard component via localStorage check
  }

  const showReady = (port: number) => {
    bar.innerHTML = '<span style="color:#22c55e;">&#9679;</span> Engine ready on port ' + port;
    setTimeout(() => {
      bar.style.transition = 'opacity 0.5s';
      bar.style.opacity = '0';
      setTimeout(() => bar.remove(), 500);
    }, 2000);
  };

  void waitForEnginePort().then((port) => {
    if (port) {
      setEnginePort(port);
      showReady(port);
      dlog(`Engine port from the shell: ${port}`);
      return;
    }
    // Older shells without the engine_port command: scan as a last resort.
    void detectEnginePort().then((scanned) => {
      if (scanned) {
        showReady(scanned);
      } else {
        bar.innerHTML = '<span style="color:#ef4444;">&#9679;</span> Engine not found. Check settings.';
      }
    });
  });
}

/** Ask the shell which port its own engine reported. Polls while the engine
 *  starts (up to 60 s). Returns null when the shell cannot answer. */
async function waitForEnginePort(): Promise<number | null> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const port = await invoke<number | null>('engine_port');
      if (typeof port === 'number' && port > 0) return port;
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export const mountDesktop = (): void => {
  if (mounted) return;
  mounted = true;
  dlog('mountDesktop - Tauri shell active');
  clearEnginePort();

  // Listen for engine-ready event from Rust backend
  void listen<number>('engine-ready', (event) => {
    const port = event.payload;
    dlog(`Received engine-ready event with port: ${port}`);
    setEnginePort(port);
    const bar = document.getElementById('cm-engine-status');
    if (bar) {
      bar.innerHTML = '<span style="color:#22c55e;">&#9679;</span> Engine ready on port ' + port;
      setTimeout(() => {
        bar.style.transition = 'opacity 0.5s';
        bar.style.opacity = '0';
        setTimeout(() => bar.remove(), 500);
      }, 2000);
    }
  });

  void installDesktopMenuListener();
  mountSidePanels();
  mountStatusBar();
};
