import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '../agent/types';

/**
 * A conversation archived from the assistant panel. Tool messages are stripped
 * before archiving because their payloads are large and the transcript view
 * never renders them; the assistant messages retain the calls they made.
 */
export interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 200;

export function archiveable(messages: Message[]): Message[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim().length > 0 || (message.toolCalls?.length ?? 0) > 0)
    .slice(-MAX_MESSAGES);
}

export function titleFor(messages: Message[]): string {
  const first = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!first) return 'Conversation';
  const text = first.content.replace(/\s+/g, ' ').trim();
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

interface ConversationState {
  conversations: StoredConversation[];
  activeId: string | null;
  /** Archive or update the thread that is currently on screen. */
  save: (messages: Message[]) => void;
  /** Begin a fresh thread without deleting the archived one. */
  startNew: () => void;
  /** Restore a thread and return its messages, or null when it is gone. */
  load: (id: string) => Message[] | null;
  remove: (id: string) => void;
  clearAll: () => void;
}

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,

      save: (messages) => {
        const kept = archiveable(messages);
        if (!kept.some((message) => message.role === 'user')) return;
        const now = Date.now();
        const { conversations, activeId } = get();
        const existing = activeId
          ? conversations.find((conversation) => conversation.id === activeId)
          : undefined;
        const record: StoredConversation = existing
          ? { ...existing, messages: kept, updatedAt: now }
          : {
              id: crypto.randomUUID(),
              title: titleFor(kept),
              messages: kept,
              createdAt: now,
              updatedAt: now,
            };
        const rest = conversations.filter((conversation) => conversation.id !== record.id);
        set({
          activeId: record.id,
          conversations: [record, ...rest].slice(0, MAX_CONVERSATIONS),
        });
      },

      startNew: () => set({ activeId: null }),

      load: (id) => {
        const conversation = get().conversations.find((entry) => entry.id === id);
        if (!conversation) return null;
        set({ activeId: id });
        return conversation.messages;
      },

      remove: (id) =>
        set((state) => ({
          conversations: state.conversations.filter((conversation) => conversation.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        })),

      clearAll: () => set({ conversations: [], activeId: null }),
    }),
    {
      name: 'circuit-muse-conversations',
      version: 1,
    },
  ),
);
