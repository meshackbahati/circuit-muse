/**
 * Multi-format project export.
 * Supports: .vlx (JSON), .zip (Wokwi-compatible), raw JSON, HTML report.
 */

import { buildVlxPayload, type VlxPayload } from './vlxFile';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import type { BoardKind } from '../types/board';

// ─── Board type mapping (CircuitMuse → Wokwi) ─────────────────────────────────
const BOARD_TO_WOKWI: Record<string, string> = {
  'arduino-uno': 'wokwi-arduino-uno',
  'arduino-nano': 'wokwi-arduino-nano',
  'arduino-mega': 'wokwi-arduino-mega',
  'raspberry-pi-pico': 'wokwi-pi-pico',
  'pi-pico-w': 'wokwi-pi-pico-w',
  'esp32': 'wokwi-esp32-devkit-v1',
  'esp32-s3': 'wokwi-esp32-devkit-v1',
  'esp32-c3': 'wokwi-esp32-devkit-v1',
};

// ─── .vlx Export ──────────────────────────────────────────────────────────
export function exportAsVlx(name?: string): Blob {
  const payload = buildVlxPayload({ name });
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

// ─── Raw JSON Export ──────────────────────────────────────────────────────
export function exportAsJson(): Blob {
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();
  const data = {
    boards: sim.boards,
    components: sim.components,
    wires: sim.wires,
    fileGroups: editor.fileGroups,
    activeBoardId: sim.activeBoardId,
    exportedAt: new Date().toISOString(),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

// ─── Wokwi ZIP Export ─────────────────────────────────────────────────────
export async function exportAsWokwiZip(name?: string): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();

  // Build diagram.json (Wokwi format)
  const parts: unknown[] = [];
  const connections: string[][] = [];

  // Add board as first part
  const activeBoard = sim.boards.find(b => b.id === sim.activeBoardId) ?? sim.boards[0];
  if (activeBoard) {
    const wokwiType = BOARD_TO_WOKWI[activeBoard.boardKind] ?? 'wokwi-arduino-uno';
    parts.push({
      type: wokwiType,
      id: 'board',
      top: activeBoard.y,
      left: activeBoard.x,
    });
  }

  // Add components
  for (const comp of sim.components) {
    const topEl = document.getElementById(comp.id);
    const attrs: Record<string, string> = {};
    if (comp.attrs) {
      for (const [k, v] of Object.entries(comp.attrs)) {
        if (v != null && v !== '') attrs[k] = String(v);
      }
    }
    parts.push({
      type: comp.metadataId,
      id: comp.id,
      top: comp.top,
      left: comp.left,
      attrs,
    });
  }

  // Add wires
  for (const wire of sim.wires) {
    connections.push([
      wire.start.componentId,
      wire.start.pinId,
      wire.end.componentId,
      wire.end.pinId,
      wire.color ?? 'green',
    ]);
  }

  zip.file('diagram.json', JSON.stringify({ version: 1, author: 'CircuitMuse', parts, connections }, null, 2));

  // Add sketch files
  const activeGroupId = activeBoard?.activeFileGroupId;
  if (activeGroupId && editor.fileGroups[activeGroupId]) {
    for (const file of editor.fileGroups[activeGroupId]) {
      zip.file(file.name, file.content);
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

// ─── HTML Report Export ───────────────────────────────────────────────────
export function exportAsHtmlReport(name?: string): Blob {
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();
  const payload = buildVlxPayload({ name });

  const boardList = sim.boards.map(b => `<li><strong>${b.boardKind}</strong> at (${b.x}, ${b.y})</li>`).join('\n');
  const componentCount = sim.components.length;
  const wireCount = sim.wires.length;

  let codeSection = '';
  for (const [gid, files] of Object.entries(editor.fileGroups)) {
    if (!files.length) continue;
    codeSection += `<h3>${gid}</h3>`;
    for (const file of files) {
      codeSection += `<h4>${file.name}</h4><pre><code>${escapeHtml(file.content)}</code></pre>`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name ?? 'CircuitMuse Project')} — Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { border-bottom: 2px solid #007acc; padding-bottom: 10px; }
    h2 { color: #007acc; margin-top: 30px; }
    h3 { color: #555; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
    code { font-size: 13px; }
    .stat { display: inline-block; margin: 10px 20px 10px 0; }
    .stat-value { font-size: 24px; font-weight: bold; color: #007acc; }
    .stat-label { font-size: 12px; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(name ?? 'CircuitMuse Project')}</h1>
  <p>Exported ${new Date().toLocaleString()}</p>

  <div>
    <div class="stat"><div class="stat-value">${sim.boards.length}</div><div class="stat-label">Boards</div></div>
    <div class="stat"><div class="stat-value">${componentCount}</div><div class="stat-label">Components</div></div>
    <div class="stat"><div class="stat-value">${wireCount}</div><div class="stat-label">Wires</div></div>
  </div>

  <h2>Boards</h2>
  <table>
    <tr><th>Board</th><th>Position</th><th>ID</th></tr>
    ${sim.boards.map(b => `<tr><td>${b.boardKind}</td><td>(${b.x}, ${b.y})</td><td>${b.id}</td></tr>`).join('\n')}
  </table>

  <h2>Components</h2>
  <table>
    <tr><th>Type</th><th>Position</th><th>ID</th></tr>
    ${sim.components.map(c => `<tr><td>${c.metadataId}</td><td>(${c.left}, ${c.top})</td><td>${c.id}</td></tr>`).join('\n')}
  </table>

  <h2>Wires</h2>
  <table>
    <tr><th>From</th><th>To</th><th>Color</th></tr>
    ${sim.wires.map(w => `<tr><td>${w.start.componentId}.${w.start.pinId}</td><td>${w.end.componentId}.${w.end.pinId}</td><td>${w.color ?? 'green'}</td></tr>`).join('\n')}
  </table>

  <h2>Source Code</h2>
  ${codeSection || '<p>No code files.</p>'}

  <div class="footer">
    Generated by CircuitMuse — <a href="https://github.com/meshackbahati/circuit-muse">github.com/meshackbahati/circuit-muse</a>
  </div>
</body>
</html>`;

  return new Blob([html], { type: 'text/html' });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Trigger Download ─────────────────────────────────────────────────────
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function safeFilename(name: string, ext: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${cleaned || 'circuit-muse-project'}.${ext}`;
}
