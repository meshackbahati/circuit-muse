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
  // Follow new output only while the reader is at the bottom. Scrolling up to
  // read pauses it; scrolling back down or sending a message resumes it.
  const followRef = useRef(true);
  const lastUserCount = useRef(0);

  useEffect(() => {
    const list = bottomRef.current?.parentElement;
    if (!list) return;
    const onScroll = () => {
      followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  const userCount = messages.filter((m) => m.role === 'user').length;
  const lastContentLength = messages.length ? messages[messages.length - 1].content.length : 0;

  useEffect(() => {
    const list = bottomRef.current?.parentElement;
    if (!list) return;
    if (userCount > lastUserCount.current) followRef.current = true; // the user just wrote
    lastUserCount.current = userCount;
    if (followRef.current) list.scrollTo({ top: list.scrollHeight });
  }, [messages.length, isStreaming, userCount, lastContentLength]);

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
        <MessageBubble key={msg.id} message={msg} toolResults={toolResults} streaming={isStreaming} />
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
