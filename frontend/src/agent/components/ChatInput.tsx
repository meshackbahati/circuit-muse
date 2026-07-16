import React, { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onAbort, disabled, isStreaming }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
