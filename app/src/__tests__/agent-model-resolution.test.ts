/**
 * The agent must never ship a bundled model catalogue. Model identifiers are
 * either chosen by the user or discovered from the configured provider API at
 * runtime, so these tests exercise resolution and discovery rather than a
 * fixed list of names that would go stale.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenAIMessages, resolveModel } from '../agent/providers/base';
import { createProvider, listProviderModels, PROVIDER_DEFAULTS } from '../agent/providers/registry';
import { AnthropicProvider } from '../agent/providers/anthropic';
import { OpenAICompatibleProvider } from '../agent/providers/openai';
import { buildGeminiContents, GeminiProvider } from '../agent/providers/gemini';
import type { LLMProvider, Message, ProviderConfig } from '../agent/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubProvider(models: string[]): LLMProvider {
  return {
    id: 'custom',
    chatStream: async function* () {},
    chat: async () => ({
      id: 'stub',
      role: 'assistant',
      content: '',
      timestamp: 0,
    }),
    listModels: async () => models,
  };
}

describe('model resolution', () => {
  it('uses the explicitly configured model and does not query the API', async () => {
    const provider = stubProvider(['api-first']);
    const listModels = vi.spyOn(provider, 'listModels');
    await expect(resolveModel(provider, '  user-typed-model  ')).resolves.toBe('user-typed-model');
    expect(listModels).not.toHaveBeenCalled();
  });

  it('falls back to the first model advertised by the API', async () => {
    await expect(resolveModel(stubProvider(['api-first', 'api-second']))).resolves.toBe('api-first');
  });

  it('fails with an actionable message when neither source supplies a model', async () => {
    await expect(resolveModel(stubProvider([]))).rejects.toThrow(/AI Provider Settings/);
  });
});

describe('provider configuration', () => {
  it('does not hardcode model defaults for any provider', () => {
    for (const defaults of Object.values(PROVIDER_DEFAULTS)) {
      expect(defaults).not.toHaveProperty('model');
    }
  });

  it('deduplicates and sorts models returned by an OpenAI-compatible API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'alpha' }] }),
    }));
    const config: ProviderConfig = {
      id: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com',
      enabled: false,
    };
    await expect(listProviderModels(config)).resolves.toEqual(['alpha', 'zeta']);
  });

  it('reads installed tags from the Ollama API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen:7b' }, { name: 'llama:latest' }] }),
    }));
    const config: ProviderConfig = {
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434',
      enabled: false,
    };
    await expect(listProviderModels(config)).resolves.toEqual(['llama:latest', 'qwen:7b']);
  });

  it('returns an empty catalogue when the API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const config: ProviderConfig = {
      id: 'anthropic',
      name: 'Anthropic',
      apiKey: 'sk-test',
      enabled: false,
    };
    await expect(listProviderModels(config)).resolves.toEqual([]);
  });
});

describe('provider API model endpoints', () => {
  it('sends the Anthropic headers when listing models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-x' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AnthropicProvider('sk-test');
    await expect(provider.listModels()).resolves.toEqual(['claude-x']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'sk-test' }),
      })
    );
  });

  it('authenticates the OpenAI-compatible model endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-x' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider('openai', 'https://api.openai.com', 'sk-test');
    await expect(provider.listModels()).resolves.toEqual(['gpt-x']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      })
    );
  });

  it('lists only chat-capable Gemini models returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-4-argon', supportedActions: ['generateContent'] },
          { name: 'models/gemini-embedding-2', supportedActions: ['embedContent'] },
        ],
      }),
    }));
    await expect(new GeminiProvider('key').listModels()).resolves.toEqual(['gemini-4-argon']);
  });
});

describe('cross-provider tool history', () => {
  function message(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
    return { id: 'm', role, content, timestamp: 0, ...extra };
  }

  it('keeps tool results whose call id matches an assistant turn', () => {
    const history = buildOpenAIMessages([
      message('assistant', '', {
        toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'read_code', arguments: '{}' } }],
      }),
      message('tool', '{"files":[]}', { toolCallId: 'call-1' }),
    ]);
    expect(history[0].tool_calls[0].id).toBe('call-1');
    expect(history[1]).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
  });

  it('relabels an orphaned tool result instead of sending an invalid call id', () => {
    const history = buildOpenAIMessages([
      message('tool', 'orphan result', { toolCallId: 'missing' }),
    ]);
    expect(history).toEqual([{ role: 'user', content: 'orphan result' }]);
  });
});

describe('Gemini history', () => {
  it('pairs native function responses with the preceding call', () => {
    const history = buildGeminiContents([
      {
        id: '1', role: 'assistant', content: '', timestamp: 0,
        toolCalls: [{
          id: 'call-1', type: 'function', thoughtSignature: 'sig-1',
          function: { name: 'read_code', arguments: '{}' },
        }],
      },
      { id: '2', role: 'tool', content: '{"files":[]}', toolCallId: 'call-1', timestamp: 0 },
    ]);
    expect(history[0].role).toBe('model');
    expect(history[0].parts[0].functionCall.thoughtSignature).toBe('sig-1');
    expect(history[1].role).toBe('user');
    expect(history[1].parts[0].functionResponse).toMatchObject({ name: 'read_code' });
  });
});

describe('NVIDIA NIM provider', () => {
  it('routes through the OpenAI-compatible endpoint without a bundled model', () => {
    const provider = createProvider({
      id: 'nvidia',
      name: 'NVIDIA NIM',
      apiKey: 'nvapi-test',
      enabled: true,
    });
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe('nvidia');
    expect(PROVIDER_DEFAULTS.nvidia).not.toHaveProperty('model');
  });
});
