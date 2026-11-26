/**
 * Stop must be immediate. The previous implementation only aborted the
 * network stream, so pressing Stop while a compile or install was in flight
 * left the chat marked as streaming and the button looked dead. This test
 * drives that exact case: a tool call that never resolves until released.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortMessage, sendMessage } from '../agent/chatService';
import { useAgentStore } from '../store/useAgentStore';
import { useProviderStore } from '../store/useProviderStore';
import { createProvider } from '../agent/providers/registry';
import { executeToolCall } from '../agent/toolExecutor';
import type { LLMProvider } from '../agent/types';

vi.mock('../agent/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/providers/registry')>();
  return { ...actual, createProvider: vi.fn() };
});

vi.mock('../agent/toolExecutor', () => ({ executeToolCall: vi.fn() }));

const makeProvider = (): LLMProvider => ({
  id: 'ollama',
  chatStream: async function* () {
    yield {
      content: '',
      toolCalls: [
        {
          id: 'call-stop',
          type: 'function',
          function: { name: 'compile_code', arguments: '{}' },
        },
      ],
    };
  },
  chat: async () => ({ id: 'stub', role: 'assistant', content: '', timestamp: 0 }),
  listModels: async () => ['test-model'],
});

afterEach(() => {
  vi.clearAllMocks();
  useAgentStore.getState().clearMessages();
  useAgentStore.getState().setStreaming(false);
  useAgentStore.getState().setExecutingTool(null);
});

describe('chat Stop', () => {
  it('clears streaming and executing state immediately during a long tool call', async () => {
    const provider = makeProvider();
    vi.mocked(createProvider).mockReturnValue(provider);
    useProviderStore.getState().setModel('ollama', 'test-model');
    useProviderStore.getState().setActiveProvider('ollama');

    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: ((value: string) => void) | null = null;
    const toolStarted = new Promise<string>((resolve) => {
      started = resolve;
    });
    vi.mocked(executeToolCall).mockImplementation(async () => {
      started?.('started');
      await gate;
      return JSON.stringify({ success: false, aborted: true, error: 'Stopped by user' });
    });

    const pending = sendMessage('build something');
    await toolStarted;
    expect(useAgentStore.getState().isStreaming).toBe(true);
    expect(useAgentStore.getState().executingTool).toBe('compile_code');

    abortMessage();

    // The important assertion: no waiting for the tool to finish.
    expect(useAgentStore.getState().isStreaming).toBe(false);
    expect(useAgentStore.getState().executingTool).toBeNull();
    expect(useAgentStore.getState().retryNotice).toBeNull();

    release?.();
    await pending;
    expect(useAgentStore.getState().isStreaming).toBe(false);
  });
});
