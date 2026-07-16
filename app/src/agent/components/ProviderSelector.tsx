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
  custom: 'Custom',
};

export const ProviderSelector: React.FC = () => {
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const providers = useProviderStore((s) => s.providers);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);

  const enabledProviders = Object.values(providers).filter((p) => p.enabled);

  return (
    <div className="agent-provider-selector">
      <select
        value={activeProviderId}
        onChange={(e) => setActiveProvider(e.target.value as ProviderId)}
        className="agent-provider-select"
      >
        {enabledProviders.map((p) => (
          <option key={p.id} value={p.id}>
            {PROVIDER_LABELS[p.id]} {p.model ? `(${p.model})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
};
