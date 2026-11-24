import type { ProviderId, LLMProvider, ProviderConfig } from '../types';
import { OpenAICompatibleProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { GeminiProvider } from './gemini';

const BASE_URLS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com',
  openrouter: 'https://openrouter.ai/api',
  moonshot: 'https://api.moonshot.cn',
  nvidia: 'https://integrate.api.nvidia.com',
  custom: '',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
  gemini: '',
};

export function createProvider(config: ProviderConfig): LLMProvider | null {
  if (!config.enabled) return null;

  switch (config.id) {
    case 'openai':
    case 'openrouter':
    case 'moonshot':
    case 'nvidia':
    case 'custom': {
      if (!config.apiKey && config.id !== 'custom') return null;
      const baseUrl = config.baseUrl || BASE_URLS[config.id];
      if (!baseUrl) return null;
      return new OpenAICompatibleProvider(config.id, baseUrl, config.apiKey || '');
    }
    case 'anthropic': {
      if (!config.apiKey) return null;
      return new AnthropicProvider(config.apiKey, config.baseUrl);
    }
    case 'ollama': {
      return new OllamaProvider(config.baseUrl || BASE_URLS.ollama);
    }
    case 'gemini': {
      if (!config.apiKey) return null;
      return new GeminiProvider(config.apiKey);
    }
    default:
      return null;
  }
}

/**
 * Provider identities carry no model defaults. Model identifiers are obtained
 * from the provider API or entered by the user, because bundled guesses become
 * stale as quickly as the APIs change.
 */
export const PROVIDER_DEFAULTS: Record<ProviderId, Partial<ProviderConfig>> = {
  openai: { name: 'OpenAI' },
  anthropic: { name: 'Anthropic' },
  ollama: { name: 'Ollama (Local)' },
  gemini: { name: 'Google Gemini' },
  openrouter: { name: 'OpenRouter' },
  moonshot: { name: 'Moonshot' },
  nvidia: { name: 'NVIDIA NIM' },
  custom: { name: 'Custom (OpenAI-compatible)' },
};

/**
 * Ask the provider API which models it currently serves. The provider is
 * instantiated as enabled here because the settings panel needs to query a
 * provider before the user has activated it for chat.
 */
export async function listProviderModels(config: ProviderConfig): Promise<string[]> {
  const provider = createProvider({ ...config, enabled: true });
  if (!provider?.listModels) return [];
  try {
    const models = await provider.listModels();
    return [...new Set(models.map(m => m.trim()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}
