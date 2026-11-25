import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../store/useAgentStore';
import { useConversationStore } from '../../store/useConversationStore';
import { useUploadsStore } from '../../store/useUploadsStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ConversationHistory } from './ConversationHistory';
import { ProviderSelector } from './ProviderSelector';
import { AgentSettings } from './AgentSettings';
import { abortMessage, sendMessage } from '../chatService';
import { ingestFiles } from '../uploadFiles';
import '../agent.css';

const HistoryIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </svg>
);

export const AgentChatPanel: React.FC = () => {
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const executingTool = useAgentStore((s) => s.executingTool);
  const retryNotice = useAgentStore((s) => s.retryNotice);
  const togglePanel = useAgentStore((s) => s.togglePanel);
  const togglePanelMinimized = useAgentStore((s) => s.togglePanelMinimized);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const setMessages = useAgentStore((s) => s.setMessages);
  const clearFiles = useUploadsStore((s) => s.clearFiles);
  const saveConversation = useConversationStore((s) => s.save);
  const startNewConversation = useConversationStore((s) => s.startNew);
  const loadConversation = useConversationStore((s) => s.load);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const saveCurrent = useCallback(() => {
    saveConversation(useAgentStore.getState().messages);
  }, [saveConversation]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showSettings) setShowSettings(false);
      else if (showHistory) setShowHistory(false);
      else togglePanel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showSettings, showHistory, togglePanel]);

  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes('Files');

  const handleDragEnter = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void ingestFiles(event.dataTransfer.files);
  };

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

  const handleNew = () => {
    if (isStreaming) abortMessage();
    saveCurrent();
    clearMessages();
    clearFiles();
    startNewConversation();
    setShowHistory(false);
  };

  const handleSelect = (id: string) => {
    if (isStreaming) abortMessage();
    saveCurrent();
    const restored = loadConversation(id);
    if (!restored) return;
    setMessages(restored);
    clearFiles();
    setShowHistory(false);
  };

  return (
    <div
      className={`agent-chat-panel${dragging ? ' agent-chat-panel-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="agent-chat-header">
        <span className="agent-chat-title">AI Agent</span>
        <div className="agent-chat-header-actions">
          <ProviderSelector />
          <button
            className={`agent-header-btn${showHistory ? ' is-active' : ''}`}
            onClick={() => {
              saveCurrent();
              setShowHistory((value) => !value);
            }}
            title="Conversation history"
            aria-label="Conversation history"
            type="button"
          >
            <HistoryIcon />
          </button>
          <button
            className="agent-header-btn"
            onClick={handleNew}
            title="New chat"
            aria-label="New chat"
            type="button"
          >
            +
          </button>
          <button
            className="agent-header-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="AI provider settings"
            type="button"
          >
            {'\u2699'}
          </button>
          <button
            className="agent-header-btn"
            onClick={togglePanelMinimized}
            title="Minimize AI Agent panel"
            aria-label="Minimize AI Agent panel"
            type="button"
          >
            {'\u2013'}
          </button>
          <button
            className="agent-header-btn"
            onClick={() => {
              saveCurrent();
              togglePanel();
            }}
            title="Close AI Agent panel"
            aria-label="Close AI Agent panel"
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      {showHistory ? (
        <ConversationHistory
          onSelect={handleSelect}
          onNew={handleNew}
          onClose={() => setShowHistory(false)}
        />
      ) : (
        <>
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            executingTool={executingTool}
            toolResults={toolResults}
          />
          {retryNotice && (
            <div className="agent-retry-notice" role="status">
              <span className="agent-retry-dot" />
              {retryNotice}
            </div>
          )}
          <ChatInput
            onSend={handleSend}
            onAbort={handleAbort}
            disabled={isStreaming}
            isStreaming={isStreaming}
          />
        </>
      )}

      {dragging && (
        <div className="agent-drop-overlay" aria-hidden="true">
          <div className="agent-drop-card">
            <strong>Drop files to attach</strong>
            <span>Images, PDFs, DOCX, and source files</span>
          </div>
        </div>
      )}
      {showSettings && <AgentSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
};
