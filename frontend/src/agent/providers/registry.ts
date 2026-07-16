import type { ProviderId, LLMProvider, ProviderConfig } from '../types';
import { OpenAICompatibleProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { GeminiProvider } from './gemini';

const BASE_URLS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com',
  openrouter: 'https://openrouter.ai/api',
  moonshot: 'https://api.moonshot.cn',
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

export const PROVIDER_DEFAULTS: Record<ProviderId, Partial<ProviderConfig>> = {
  openai: { name: 'OpenAI', model: 'gpt-4o-mini' },
  anthropic: { name: 'Anthropic', model: 'claude-sonnet-4-20250514' },
  ollama: { name: 'Ollama (Local)', model: 'llama3' },
  gemini: { name: 'Google Gemini', model: 'gemini-2.0-flash' },
  openrouter: { name: 'OpenRouter', model: 'openai/gpt-4o-mini' },
  moonshot: { name: 'Moonshot', model: 'moonshot-v1-8k' },
  custom: { name: 'Custom (OpenAI-compatible)', model: '' },
};
