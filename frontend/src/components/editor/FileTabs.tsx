import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, CHIP_GROUP_PREFIX } from '../../store/useEditorStore';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { boardDisplayName } from '../../types/board';
import './FileTabs.css';

export const FileTabs: React.FC = () => {
  const { t } = useTranslation();
  const { files, openFileIds, activeFileId, activeGroupId, setActiveFile, closeFile } =
    useEditorStore();
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const openFiles = openFileIds
    .map((id) => files.find((f) => f.id === id))
    .filter(Boolean) as typeof files;

  // Which target owns the files currently shown — a board or a custom chip —
  // so the user can tell whose code they're editing at a glance. Resolved as a
  // SELECTOR returning just the label string, so FileTabs only re-renders when
  // that label changes — not on every pin toggle that mutates the components
  // array during simulation.
  const ownerLabel = useSimulatorStore((s): string | null => {
    if (activeGroupId?.startsWith(CHIP_GROUP_PREFIX)) {
      const chipId = activeGroupId.slice(CHIP_GROUP_PREFIX.length);
      const chip = s.components.find((c) => c.id === chipId);
      return (
        String((chip?.properties as Record<string, unknown>)?.chipName ?? '').trim() ||
        'Custom Chip'
      );
    }
    const board = s.boards.find((b) => b.activeFileGroupId === activeGroupId);
    return board ? boardDisplayName(board) : null;
  });

  const handleCloseClick = (e: React.MouseEvent, fileId: string, modified: boolean) => {
    e.stopPropagation();
    if (modified) {
      setConfirmCloseId(fileId);
    } else {
      closeFile(fileId);
    }
  };

  const confirmClose = () => {
    if (confirmCloseId) closeFile(confirmCloseId);
    setConfirmCloseId(null);
  };

  return (
    <>
      <div className="file-tabs">
        {ownerLabel && (
          <span className="file-tabs-owner" title={`These files belong to ${ownerLabel}`}>
            {ownerLabel}
          </span>
        )}
        {openFiles.map((file) => (
          <div
            key={file.id}
            className={`file-tab${file.id === activeFileId ? ' file-tab-active' : ''}`}
            onClick={() => setActiveFile(file.id)}
            title={file.name}
          >
            {file.modified && (
              <span className="file-tab-modified" title={t('editor.fileTabs.unsavedChanges')} />
            )}
            <span className="file-tab-name">{file.name}</span>
            <button
              className="file-tab-close"
              onClick={(e) => handleCloseClick(e, file.id, file.modified)}
              title={t('editor.fileTabs.close')}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {confirmCloseId && (
        <div className="ftabs-overlay" onClick={() => setConfirmCloseId(null)}>
          <div className="ftabs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>{t('editor.fileTabs.confirmClose')}</p>
            <div className="ftabs-confirm-actions">
              <button className="ftabs-btn-close" onClick={confirmClose}>
                {t('editor.fileTabs.closeAnyway')}
              </button>
              <button onClick={() => setConfirmCloseId(null)}>{t('editor.fileTabs.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
