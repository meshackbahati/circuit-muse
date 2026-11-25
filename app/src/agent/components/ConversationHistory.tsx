import React, { useMemo, useState } from 'react';
import { useConversationStore, type StoredConversation } from '../../store/useConversationStore';

interface ConversationHistoryProps {
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

function stamp(value: number): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function summary(conversation: StoredConversation): string {
  const replies = conversation.messages.filter((message) => message.role === 'assistant').length;
  const turns = Math.ceil(replies / 2);
  return `${turns || 1} ${turns === 1 ? 'exchange' : 'exchanges'} · ${stamp(conversation.updatedAt)}`;
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  onSelect,
  onNew,
  onClose,
}) => {
  const conversations = useConversationStore((state) => state.conversations);
  const activeId = useConversationStore((state) => state.activeId);
  const remove = useConversationStore((state) => state.remove);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  return (
    <div className="agent-history">
      <div className="agent-history-top">
        <button className="agent-history-back" type="button" onClick={onClose}>
          Back to chat
        </button>
        <button className="agent-history-new" type="button" onClick={onNew}>
          New chat
        </button>
      </div>

      <input
        className="agent-history-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search conversations"
        aria-label="Search conversations"
      />

      {visible.length === 0 ? (
        <div className="agent-history-empty">
          <strong>{conversations.length === 0 ? 'No saved conversations yet' : 'No matches'}</strong>
          <span>
            {conversations.length === 0
              ? 'Threads are saved automatically after the first reply.'
              : 'Try a different word from the conversation title.'}
          </span>
        </div>
      ) : (
        <div className="agent-history-list">
          {visible.map((conversation) => (
            <div
              key={conversation.id}
              className={`agent-history-row${conversation.id === activeId ? ' is-active' : ''}`}
            >
              <button
                className="agent-history-open"
                type="button"
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
              >
                <span className="agent-history-title">{conversation.title}</span>
                <span className="agent-history-meta">{summary(conversation)}</span>
              </button>
              <button
                className="agent-history-delete"
                type="button"
                onClick={() => remove(conversation.id)}
                aria-label={`Delete ${conversation.title}`}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
