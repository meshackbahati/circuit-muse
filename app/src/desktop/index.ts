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
import { detectEnginePort } from '../services/engineConfig';
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

  // Auto-detect engine in background
  detectEnginePort().then((port) => {
    if (port) {
      bar.innerHTML = '<span style="color:#22c55e;">&#9679;</span> Engine ready on port ' + port;
      setTimeout(() => {
        bar.style.transition = 'opacity 0.5s';
        bar.style.opacity = '0';
        setTimeout(() => bar.remove(), 500);
      }, 2000);
      dlog(`Engine detected on port ${port}`);
    } else {
      bar.innerHTML = '<span style="color:#f59e0b;">&#9679;</span> Engine starting... (compiling may take a moment)';
      // Retry after delay
      setTimeout(() => {
        detectEnginePort().then((p) => {
          if (p) {
            bar.innerHTML = '<span style="color:#22c55e;">&#9679;</span> Engine ready on port ' + p;
            setTimeout(() => {
              bar.style.transition = 'opacity 0.5s';
              bar.style.opacity = '0';
              setTimeout(() => bar.remove(), 500);
            }, 2000);
          } else {
            bar.innerHTML = '<span style="color:#ef4444;">&#9679;</span> Engine not found. Check settings.';
          }
        });
      }, 10000);
      dlog('Engine not detected yet');
    }
  });
}

export const mountDesktop = (): void => {
  if (mounted) return;
  mounted = true;
  dlog('mountDesktop - Tauri shell active');

  void installDesktopMenuListener();
  mountSidePanels();
  mountStatusBar();
};
