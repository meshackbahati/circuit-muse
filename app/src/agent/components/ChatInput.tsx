import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ingestFiles } from '../uploadFiles';
import { useUploadsStore, type UploadedFile } from '../../store/useUploadsStore';

interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

const ACCEPT =
  '.txt,.md,.json,.csv,.xml,.yml,.yaml,.ino,.c,.cpp,.h,.py,.js,.ts,.jsx,.tsx,.html,.css,.log,.svg,.pdf,.docx,image/*';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(file: UploadedFile): string {
  if (file.kind === 'pdf') return 'PDF';
  if (file.kind === 'docx') return 'DOC';
  if (file.kind === 'text') {
    const ext = file.name.split('.').pop();
    return ext ? ext.toUpperCase().slice(0, 4) : 'TXT';
  }
  return 'FILE';
}

function pastedName(file: File, index: number): string {
  const generic = !file.name || file.name === 'image.png' || file.name === 'blob';
  if (!generic) return file.name;
  const ext = file.type.split('/')[1] || 'bin';
  return `pasted-${Date.now()}-${index}.${ext}`;
}

const PaperclipIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const SendIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

const StopIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onAbort, disabled, isStreaming }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploads = useUploadsStore((s) => s.files);
  const removeFile = useUploadsStore((s) => s.removeFile);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const canSend = useMemo(() => input.trim().length > 0 && !disabled, [input, disabled]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fromFiles = Array.from(event.clipboardData.files);
    const fromItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const files = fromFiles.length > 0 ? fromFiles : fromItems;
    if (files.length === 0) return;
    event.preventDefault();
    void ingestFiles(
      files.map((file, index) => {
        const name = pastedName(file, index);
        return name === file.name ? file : new File([file], name, { type: file.type });
      }),
    );
  };

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void ingestFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <div className="agent-chat-input">
      {uploads.length > 0 && (
        <div className="agent-attachment-tray" aria-label="Attached files">
          {uploads.map((file) => (
            <div
              key={file.id}
              className={`agent-attachment${file.error ? ' agent-attachment-error' : ''}`}
              title={file.error || file.name}
            >
              {file.kind === 'image' && file.dataUrl ? (
                <img className="agent-attachment-thumb" src={file.dataUrl} alt="" />
              ) : (
                <span className="agent-attachment-badge">{kindLabel(file)}</span>
              )}
              <span className="agent-attachment-meta">
                <span className="agent-attachment-name">{file.name}</span>
                <span className="agent-attachment-size">
                  {file.error ? file.error : formatBytes(file.size)}
                </span>
              </span>
              <button
                className="agent-attachment-remove"
                type="button"
                onClick={() => removeFile(file.id)}
                aria-label={`Remove ${file.name}`}
                title={`Remove ${file.name}`}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="agent-composer-box">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isStreaming
              ? 'Add a follow-up. The agent reads it at its next step.'
              : 'Ask CircuitMuse to build a circuit. Paste or drop files here.'
          }
          disabled={disabled}
          rows={1}
          className="agent-chat-textarea"
          aria-label="Message CircuitMuse"
        />
        <div className="agent-composer-toolbar">
          <div className="agent-composer-tools">
            <button
              className="agent-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              aria-label="Attach files"
              type="button"
            >
              <PaperclipIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={handlePick}
            />
            <span className="agent-composer-hint" title="Enter sends, Shift+Enter adds a new line">
              Enter to send. Paste or drop files.
            </span>
          </div>
          {isStreaming && onAbort && (
            <button className="agent-stop-btn" onClick={onAbort} type="button" title="Stop the agent">
              <StopIcon />
              Stop
            </button>
          )}
          {(!isStreaming || input.trim().length > 0) && (
            <button
              className="agent-send-btn"
              onClick={handleSubmit}
              disabled={!canSend}
              type="button"
              title={isStreaming ? 'Send a follow-up to the working agent' : 'Send message'}
              aria-label={isStreaming ? 'Send follow-up' : 'Send message'}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
