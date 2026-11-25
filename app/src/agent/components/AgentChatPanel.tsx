import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../store/useAgentStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ProviderSelector } from './ProviderSelector';
import { AgentSettings } from './AgentSettings';
import { abortMessage, sendMessage } from '../chatService';
import { readUploadedFile } from '../fileReader';
import { useUploadsStore } from '../../store/useUploadsStore';
import '../agent.css';

export const AgentChatPanel: React.FC = () => {
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const executingTool = useAgentStore((s) => s.executingTool);
  const togglePanel = useAgentStore((s) => s.togglePanel);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploads = useUploadsStore((s) => s.files);
  const addFile = useUploadsStore((s) => s.addFile);
  const removeFile = useUploadsStore((s) => s.removeFile);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showSettings) setShowSettings(false);
      else togglePanel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSettings, togglePanel]);

  const toolResults: Record<string, string> = {};
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      toolResults[msg.toolCallId] = msg.content;
    }
  }

  const handleSend = (content: string) => {
    void sendMessage(content);
  };

  const handleAbort = () => {
    abortMessage();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      addFile(await readUploadedFile(file));
    }
  };

  return (
    <div className="agent-chat-panel">
      <div className="agent-chat-header">
        <span className="agent-chat-title">AI Agent</span>
        <div className="agent-chat-header-actions">
          <button
            className="agent-header-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            type="button"
          >
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.json,.csv,.xml,.yml,.yaml,.ino,.c,.cpp,.h,.py,.js,.ts,.jsx,.tsx,.html,.css,.log,.svg,.pdf,.docx,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <ProviderSelector />
          <button
            className="agent-header-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            type="button"
          >
            {'\u2699'}
          </button>
          <button
            className="agent-header-btn"
            onClick={clearMessages}
            title="Clear conversation"
            aria-label="Clear conversation"
            type="button"
          >
            Clear
          </button>
          <button
            className="agent-header-btn"
            onClick={togglePanel}
            title="Close AI Agent panel"
            aria-label="Close AI Agent panel"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      {uploads.length > 0 && (
        <div className="agent-upload-list">
          {uploads.map((file) => (
            <span key={file.id} className="agent-upload-chip" title={file.name}>
              {file.name}
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        executingTool={executingTool}
        toolResults={toolResults}
      />
      <ChatInput
        onSend={handleSend}
        onAbort={handleAbort}
        disabled={isStreaming}
        isStreaming={isStreaming}
      />
      {showSettings && <AgentSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
};
