import { create } from 'zustand';
import type { Message } from '../agent/types';

/** Older turns are trimmed from the in-memory transcript so long agent
 *  sessions do not grow without bound. Tool messages that are still needed
 *  by the next provider call are kept until a newer turn pushes them out. */
const MAX_MESSAGES = 80;

function trimMessages(messages: Message[]): Message[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
}

interface AgentState {
  messages: Message[];
  isStreaming: boolean;
  executingTool: string | null;
  panelOpen: boolean;
  panelMinimized: boolean;
  panelWidth: number;
  /** Transient status shown while the provider is being retried. */
  retryNotice: string | null;

  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => string;
  setMessages: (messages: Message[]) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setExecutingTool: (tool: string | null) => void;
  setRetryNotice: (notice: string | null) => void;
  clearMessages: () => void;
  togglePanel: () => void;
  togglePanelMinimized: () => void;
  setPanelWidth: (width: number) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  messages: [],
  isStreaming: false,
  executingTool: null,
  panelOpen: false,
  panelMinimized: false,
  panelWidth: 420,
  retryNotice: null,

  addMessage: (msg) => {
    const id = crypto.randomUUID();
    const next = { ...msg, id, timestamp: Date.now() };
    set((state) => ({ messages: trimMessages([...state.messages, next]) }));
    return id;
  },

  setMessages: (messages) => set({ messages: trimMessages(messages) }),
  updateMessage: (id, patch) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...patch } : m),
  })),

  updateLastAssistantMessage: (content) => set((state) => {
    const msgs = [...state.messages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content };
        break;
      }
    }
    return { messages: msgs };
  }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setExecutingTool: (tool) => set({ executingTool: tool }),
  setRetryNotice: (notice) => set({ retryNotice: notice }),
  clearMessages: () => set({ messages: [] }),
  togglePanel: () =>
    set((state) =>
      state.panelOpen
        ? { panelOpen: false, panelMinimized: false }
        : { panelOpen: true, panelMinimized: false },
    ),
  togglePanelMinimized: () => set((state) => ({ panelMinimized: !state.panelMinimized })),
  setPanelWidth: (width) => set({ panelWidth: Math.max(300, Math.min(800, width)) }),
}));
