import { create } from 'zustand';
import type { Message } from '../agent/types';

interface AgentState {
  messages: Message[];
  isStreaming: boolean;
  executingTool: string | null;
  panelOpen: boolean;
  panelWidth: number;

  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => string;
  setMessages: (messages: Message[]) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setExecutingTool: (tool: string | null) => void;
  clearMessages: () => void;
  togglePanel: () => void;
  setPanelWidth: (width: number) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  messages: [],
  isStreaming: false,
  executingTool: null,
  panelOpen: false,
  panelWidth: 400,

  addMessage: (msg) => {
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [...state.messages, { ...msg, id, timestamp: Date.now() }],
    }));
    return id;
  },

  setMessages: (messages) => set({ messages }),
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
  clearMessages: () => set({ messages: [] }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setPanelWidth: (width) => set({ panelWidth: Math.max(300, Math.min(800, width)) }),
}));
