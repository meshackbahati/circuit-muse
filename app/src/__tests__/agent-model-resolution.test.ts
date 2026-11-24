/**
 * The agent must never ship a bundled model catalogue. Model identifiers are
 * either chosen by the user or discovered from the configured provider API at
 * runtime, so these tests exercise resolution and discovery rather than a
 * fixed list of names that would go stale.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveModel } from '../agent/providers/base';
import { listProviderModels, PROVIDER_DEFAULTS } from '../agent/providers/registry';
import { AnthropicProvider } from '../agent/providers/anthropic';
import { OpenAICompatibleProvider } from '../agent/providers/openai';
import type { LLMProvider, ProviderConfig } from '../agent/types';

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
});
