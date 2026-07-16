import { create } from 'zustand';
import type { Message, ProviderId } from '../agent/types';

interface AgentState {
  messages: Message[];
  isStreaming: boolean;
  executingTool: string | null;
  panelOpen: boolean;
  panelWidth: number;
  activeProviderId: ProviderId;

  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateLastAssistantMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setExecutingTool: (tool: string | null) => void;
  clearMessages: () => void;
  togglePanel: () => void;
  setPanelWidth: (width: number) => void;
  setActiveProvider: (id: ProviderId) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  messages: [],
  isStreaming: false,
  executingTool: null,
  panelOpen: false,
  panelWidth: 400,
  activeProviderId: 'ollama',

  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }],
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
  setActiveProvider: (id) => set({ activeProviderId: id }),
}));
