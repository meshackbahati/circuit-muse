import React, { useEffect, useState } from 'react';
import { useAgentStore } from '../../store/useAgentStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ProviderSelector } from './ProviderSelector';
import { AgentSettings } from './AgentSettings';
import { abortMessage, sendMessage } from '../chatService';
import '../agent.css';

export const AgentChatPanel: React.FC = () => {
  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const executingTool = useAgentStore((s) => s.executingTool);
  const togglePanel = useAgentStore((s) => s.togglePanel);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const [showSettings, setShowSettings] = useState(false);

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

  return (
    <div className="agent-chat-panel">
      <div className="agent-chat-header">
        <span className="agent-chat-title">AI Agent</span>
        <div className="agent-chat-header-actions">
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
