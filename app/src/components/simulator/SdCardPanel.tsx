/**
 * SdCardPanel — the "SD Card" file panel shown in the component property dialog
 * for the microsd-card component.
 *
 * Free: the project's text files are auto-copied onto the card (handled
 * elsewhere, at simulation start). This panel is the PAID path: uploading your
 * own files — binaries included (images, audio, data) — which the editor cannot
 * accept any other way. Gated via `proSdCardGate`: a non-paid user clicking
 * "Add files" gets the upgrade prompt instead of the file picker.
 *
 * Files are persisted on the component as `properties.sdFiles`
 * (`{ name, contentB64 }[]`), so they travel with the project (.vlx) and feed
 * `buildProjectSdImage` on the next run.
 */
import React, { useRef } from 'react';
import {
  bytesToB64,
  SD_UPLOAD_MAX_BYTES,
  type UploadedSdFile,
} from '../../utils/sdCardFiles';
import { sdCardUploadAllowed, triggerSdCardUpgradePrompt } from '../../lib/proSdCardGate';

interface SdCardPanelProps {
  files: UploadedSdFile[];
  onChange: (next: UploadedSdFile[]) => void;
}

function fileBytes(f: UploadedSdFile): number {
  const b = f.contentB64;
  const pad = b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b.length * 3) / 4) - pad);
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const SdCardPanel: React.FC<SdCardPanelProps> = ({ files, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const total = files.reduce((s, f) => s + fileBytes(f), 0);

  const openPicker = (): void => {
    // Gate the PAID action: a non-paid user gets the upgrade prompt instead.
    if (!sdCardUploadAllowed()) {
      triggerSdCardUpgradePrompt();
      return;
    }
    inputRef.current?.click();
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    const next = [...files];
    let running = total;
    for (const file of picked) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (running + bytes.length > SD_UPLOAD_MAX_BYTES) continue; // skip oversize
      running += bytes.length;
      const entry: UploadedSdFile = { name: file.name, contentB64: bytesToB64(bytes) };
      const idx = next.findIndex((f) => f.name.toLowerCase() === file.name.toLowerCase());
      if (idx >= 0) next[idx] = entry;
      else next.push(entry);
    }
    onChange(next);
  };

  const remove = (name: string): void => onChange(files.filter((f) => f.name !== name));

  return (
    <div className="sd-card-section">
      <div className="sd-card-label">
        SD Card files <span className="sd-card-paid">Paid</span>
      </div>
      {files.length === 0 && (
        <div className="sd-card-hint">
          Upload your own files (images, audio, data). Project files are added
          automatically.
        </div>
      )}
      {files.map((f) => (
        <div key={f.name} className="sd-card-file">
          <span className="sd-card-file-name" title={f.name}>
            {f.name}
          </span>
          <span className="sd-card-file-size">{humanSize(fileBytes(f))}</span>
          <button
            className="sd-card-file-remove"
            title="Remove"
            onClick={() => remove(f.name)}
          >
            x
          </button>
        </div>
      ))}
      <div className="sd-card-footer">
        <button className="sd-card-add" onClick={openPicker}>
          + Add files
        </button>
        <span className="sd-card-total">
          {humanSize(total)} / {humanSize(SD_UPLOAD_MAX_BYTES)}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handlePick}
      />
    </div>
  );
};
