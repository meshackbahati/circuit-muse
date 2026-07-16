/**
 * Export menu — multiple export formats for the current project.
 */

import { useState } from 'react';
import {
  exportAsVlx,
  exportAsJson,
  exportAsWokwiZip,
  exportAsHtmlReport,
  triggerDownload,
  safeFilename,
} from '../../utils/exportFormats';
import { useProjectStore } from '../../store/useProjectStore';

interface ExportMenuProps {
  onClose: () => void;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ onClose }) => {
  const [exporting, setExporting] = useState<string | null>(null);
  const projectName = useProjectStore((s) => s.currentProject?.slug ?? 'circuit-muse-project');

  const handleExport = async (format: string) => {
    setExporting(format);
    try {
      const name = projectName;
      switch (format) {
        case 'vlx': {
          const blob = exportAsVlx(name);
          triggerDownload(blob, safeFilename(name, 'vlx'));
          break;
        }
        case 'json': {
          const blob = exportAsJson();
          triggerDownload(blob, safeFilename(name, 'json'));
          break;
        }
        case 'zip': {
          const blob = await exportAsWokwiZip(name);
          triggerDownload(blob, safeFilename(name, 'zip'));
          break;
        }
        case 'html': {
          const blob = exportAsHtmlReport(name);
          triggerDownload(blob, safeFilename(name, 'html'));
          break;
        }
      }
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-header">
          <h3>Export Project</h3>
          <button className="export-close" onClick={onClose} type="button">
            {'\u2715'}
          </button>
        </div>
        <div className="export-list">
          <button
            className="export-item"
            onClick={() => handleExport('vlx')}
            disabled={!!exporting}
            type="button"
          >
            <div className="export-item-name">.vlx (Velxio Format)</div>
            <div className="export-item-desc">Single-file JSON snapshot, full fidelity</div>
          </button>
          <button
            className="export-item"
            onClick={() => handleExport('zip')}
            disabled={!!exporting}
            type="button"
          >
            <div className="export-item-name">.zip (Wokwi Compatible)</div>
            <div className="export-item-desc">diagram.json + sketch files, importable in Wokwi</div>
          </button>
          <button
            className="export-item"
            onClick={() => handleExport('json')}
            disabled={!!exporting}
            type="button"
          >
            <div className="export-item-name">.json (Raw Data)</div>
            <div className="export-item-desc">Full project state as JSON</div>
          </button>
          <button
            className="export-item"
            onClick={() => handleExport('html')}
            disabled={!!exporting}
            type="button"
          >
            <div className="export-item-name">.html (Report)</div>
            <div className="export-item-desc">Shareable HTML report with boards, components, code</div>
          </button>
        </div>
      </div>

      <style>{`
        .export-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .export-modal {
          width: 420px;
          background: #1e1e23;
          border: 1px solid #2c2c33;
          border-radius: 8px;
          overflow: hidden;
        }
        .export-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid #2c2c33;
        }
        .export-header h3 { margin: 0; font-size: 16px; }
        .export-close {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 16px;
        }
        .export-close:hover { color: #e6e6e9; }
        .export-list {
          padding: 8px;
        }
        .export-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          border: none;
          background: transparent;
          color: #e6e6e9;
          cursor: pointer;
          border-radius: 6px;
          font-family: inherit;
        }
        .export-item:hover { background: #2c2c33; }
        .export-item:disabled { opacity: 0.5; cursor: wait; }
        .export-item-name { font-size: 14px; font-weight: 500; }
        .export-item-desc { font-size: 12px; color: #888; margin-top: 2px; }
      `}</style>
    </div>
  );
};
