import React from 'react';
import { useProviderStore } from '../../store/useProviderStore';
import type { ProviderId } from '../types';

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  moonshot: 'Moonshot',
  nvidia: 'NVIDIA NIM',
  custom: 'Custom',
};

export const ProviderSelector: React.FC = () => {
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const providers = useProviderStore((s) => s.providers);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);

  const allProviders = Object.values(providers);

  const isConfigured = (p: (typeof allProviders)[number]) => {
    if (p.id === 'ollama') return true;
    if (p.id === 'custom') return Boolean(p.baseUrl?.trim());
    return Boolean(p.apiKey?.trim());
  };

  return (
    <div className="agent-provider-selector">
      <select
        value={activeProviderId}
        onChange={(e) => setActiveProvider(e.target.value as ProviderId)}
        className="agent-provider-select"
      >
        {allProviders.map((p) => (
          <option key={p.id} value={p.id}>
            {PROVIDER_LABELS[p.id]}
            {p.model ? ` (${p.model})` : isConfigured(p) ? '' : ' (not configured)'}
          </option>
        ))}
      </select>
    </div>
  );
};
