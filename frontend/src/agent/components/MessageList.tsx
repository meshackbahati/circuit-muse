import React, { useEffect, useRef } from 'react';
import type { Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { StreamingIndicator } from './StreamingIndicator';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  executingTool: string | null;
  toolResults?: Record<string, string>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isStreaming,
  executingTool,
  toolResults = {},
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const visibleMessages = messages.filter(
    (m) => m.role !== 'system' && m.role !== 'tool',
  );

  return (
    <div className="agent-message-list">
      {visibleMessages.length === 0 && (
        <div className="agent-empty-state">
          <div className="agent-empty-icon">{'\u26A1'}</div>
          <p>Ask me to build a circuit!</p>
          <p className="agent-empty-hint">
            Try: "Add an Arduino Uno and wire an LED to pin 13"
          </p>
        </div>
      )}
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} toolResults={toolResults} />
      ))}
      {isStreaming && (
        <div className="agent-message agent-message-assistant">
          <div className="agent-message-role">CircuitMuse</div>
          <div className="agent-message-content">
            <StreamingIndicator toolName={executingTool ?? undefined} />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
};
