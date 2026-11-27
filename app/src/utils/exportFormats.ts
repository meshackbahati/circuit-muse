/**
 * Multi-format project export.
 * Supports: .vlx (JSON), .zip (Wokwi-compatible), raw JSON, HTML report.
 */

import { buildVlxPayload } from './vlxFile';
import { buildWokwiZipBlob } from './wokwiZip';

// ─── .vlx Export ──────────────────────────────────────────────────────────
export function exportAsVlx(name?: string): Blob {
  const payload = buildVlxPayload({ name });
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

// ─── Raw JSON Export ──────────────────────────────────────────────────────
// Same validated shape as .vlx so it imports back through the same checks.
// (It used to dump live board state — compiled firmware, serial output,
// running flags — and skip chip programs and per-board settings.)
export function exportAsJson(name?: string): Blob {
  const payload = buildVlxPayload({ name });
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

// ─── Wokwi ZIP Export ─────────────────────────────────────────────────────
// diagram.json + sketch files for Wokwi, plus the full snapshot so a
// CircuitMuse round-trip loses nothing.
export async function exportAsWokwiZip(name?: string): Promise<Blob> {
  return buildWokwiZipBlob(buildVlxPayload({ name }));
}

// ─── HTML Report Export ───────────────────────────────────────────────────
export function exportAsHtmlReport(name?: string): Blob {
  const payload = buildVlxPayload({ name, includeChat: false });
  const title = escapeHtml(name ?? 'CircuitMuse Project');
  const boardLabel = new Map(payload.boards.map((b) => [b.id, b.name || b.boardKind]));

  let codeSection = '';
  for (const [gid, files] of Object.entries(payload.fileGroups)) {
    if (!files.length) continue;
    const owner = payload.boards.find((b) => b.activeFileGroupId === gid);
    codeSection += `<h3>${escapeHtml(owner ? (boardLabel.get(owner.id) ?? gid) : gid)}</h3>`;
    for (const file of files) {
      codeSection += `<h4>${escapeHtml(file.name)}</h4><pre><code>${escapeHtml(file.content)}</code></pre>`;
    }
  }

  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n)) : '?');
  const props = (p: Record<string, unknown>) =>
    Object.entries(p ?? {})
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(String(v))}`)
      .join(', ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>${title} — Report</title>
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
  <h1>${title}</h1>
  <p>Exported ${escapeHtml(new Date().toLocaleString())}</p>

  <div>
    <div class="stat"><div class="stat-value">${payload.boards.length}</div><div class="stat-label">Boards</div></div>
    <div class="stat"><div class="stat-value">${payload.components.length}</div><div class="stat-label">Components</div></div>
    <div class="stat"><div class="stat-value">${payload.wires.length}</div><div class="stat-label">Wires</div></div>
  </div>

  <h2>Boards</h2>
  <table>
    <tr><th>Board</th><th>Position</th><th>ID</th><th>Language</th></tr>
    ${payload.boards.map((b) => `<tr><td>${escapeHtml(b.name ? `${b.name} (${b.boardKind})` : b.boardKind)}</td><td>(${fmt(b.x)}, ${fmt(b.y)})</td><td>${escapeHtml(b.id)}</td><td>${escapeHtml(b.languageMode ?? 'arduino')}</td></tr>`).join('\n')}
  </table>

  <h2>Components</h2>
  <table>
    <tr><th>Type</th><th>Position</th><th>ID</th><th>Properties</th></tr>
    ${payload.components.map((c) => `<tr><td>${escapeHtml(c.metadataId)}</td><td>(${fmt(c.x)}, ${fmt(c.y)})</td><td>${escapeHtml(c.id)}</td><td>${props(c.properties)}</td></tr>`).join('\n')}
  </table>

  <h2>Wires</h2>
  <table>
    <tr><th>From</th><th>To</th><th>Color</th></tr>
    ${payload.wires.map((w) => `<tr><td>${escapeHtml(`${w.start.componentId}.${w.start.pinName}`)}</td><td>${escapeHtml(`${w.end.componentId}.${w.end.pinName}`)}</td><td>${escapeHtml(w.color ?? '')}</td></tr>`).join('\n')}
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

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  // Keep letters/digits from any script (é, ü, 中文) — only strip characters
  // that are unsafe in file names. Leading dots would make a hidden file.
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 80);
  return `${cleaned || 'circuit-muse-project'}.${ext}`;
}
