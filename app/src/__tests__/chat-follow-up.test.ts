/**
 * The user can send a follow-up while the agent works. It must not abort the
 * turn, must appear in the chat once, and must reach the model at the next
 * step (before, sending was blocked while the agent was working).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortMessage, sendMessage } from '../agent/chatService';
import { useAgentStore } from '../store/useAgentStore';
import { useProviderStore } from '../store/useProviderStore';
import { createProvider } from '../agent/providers/registry';
import { executeToolCall } from '../agent/toolExecutor';
import type { ChatParams, LLMProvider, Message } from '../agent/types';

vi.mock('../agent/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/providers/registry')>();
  return { ...actual, createProvider: vi.fn() };
});
vi.mock('../agent/toolExecutor', () => ({ executeToolCall: vi.fn() }));

afterEach(() => {
  abortMessage();
  vi.clearAllMocks();
  useAgentStore.getState().clearMessages();
  useAgentStore.getState().setStreaming(false);
  useAgentStore.getState().setExecutingTool(null);
});

describe('follow-up while the agent works', () => {
  it('queues the message and gives it to the model at the next step', async () => {
    const seen: Message[][] = [];
    let call = 0;
    const provider: LLMProvider = {
      id: 'ollama',
      chatStream: async function* (params: ChatParams) {
        seen.push(params.messages.map((m) => ({ ...m })));
        call++;
        if (call === 1) {
          // First step asks for a tool; the tool waits until released.
          yield { content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_code', arguments: '{}' } }] };
          return;
        }
        yield { content: 'Done. I used the green LED as you asked.', done: true };
      },
      chat: async () => ({ id: 'x', role: 'assistant', content: '', timestamp: 0 }),
      listModels: async () => ['test-model'],
    };
    vi.mocked(createProvider).mockReturnValue(provider);
    useProviderStore.getState().setModel('ollama', 'test-model');
    useProviderStore.getState().setActiveProvider('ollama');

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(executeToolCall).mockImplementation(async () => {
      started();
      await gate;
      return JSON.stringify({ success: true, code: 'void setup(){}' });
    });

    const turn = sendMessage('blink an LED');
    await toolStarted;
    expect(useAgentStore.getState().isStreaming).toBe(true);

    await sendMessage('use the green LED instead');
    // Shown in the chat right away, exactly once, and the turn keeps running.
    const userTexts = useAgentStore.getState().messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userTexts).toEqual(['blink an LED', 'use the green LED instead']);
    expect(useAgentStore.getState().isStreaming).toBe(true);

    release();
    await turn;

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const second = seen[1].filter((m) => m.role === 'user').map((m) => m.content);
    expect(second.some((c) => c.includes('use the green LED instead'))).toBe(true);
    const finalText = useAgentStore.getState().messages.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ');
    expect(finalText).toContain('green LED');
  });

  it('Stop drops queued follow-ups', async () => {
    const provider: LLMProvider = {
      id: 'ollama',
      chatStream: async function* () {
        yield { content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_code', arguments: '{}' } }] };
      },
      chat: async () => ({ id: 'x', role: 'assistant', content: '', timestamp: 0 }),
      listModels: async () => ['test-model'],
    };
    vi.mocked(createProvider).mockReturnValue(provider);
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(executeToolCall).mockImplementation(() => {
      started();
      return new Promise(() => {}); // never resolves
    });
    void sendMessage('start');
    await toolStarted;
    await sendMessage('queued');
    abortMessage();
    await new Promise((r) => setTimeout(r, 20));
    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(vi.mocked(createProvider).mock.calls.length).toBe(1); // no resumed turn
  });
});
