import React, { useState, useRef, useEffect } from 'react';
import { readUploadedFile } from '../fileReader';
import { useUploadsStore } from '../../store/useUploadsStore';

interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onAbort, disabled, isStreaming }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFile = useUploadsStore((s) => s.addFile);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="agent-chat-input">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask CircuitMuse to build a circuit..."
        disabled={disabled}
        rows={1}
        className="agent-chat-textarea"
      />
      <div className="agent-chat-actions">
        <button
          className="agent-btn agent-btn-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Attach documents or images"
          type="button"
        >
          Attach file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.json,.csv,.xml,.yml,.yaml,.ino,.c,.cpp,.h,.py,.js,.ts,.jsx,.tsx,.html,.css,.log,.svg,.pdf,.docx,image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) void Promise.all(Array.from(files).map(readUploadedFile)).then(added => added.forEach(addFile));
            e.target.value = '';
          }}
        />
        {isStreaming && onAbort ? (
          <button
            className="agent-btn agent-btn-abort"
            onClick={onAbort}
            type="button"
          >
            Stop
          </button>
        ) : (
          <button
            className="agent-btn agent-btn-send"
            onClick={handleSubmit}
            disabled={disabled || !input.trim()}
            type="button"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
