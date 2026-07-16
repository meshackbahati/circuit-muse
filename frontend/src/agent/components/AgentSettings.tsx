import React from 'react';
import { useProviderStore } from '../../store/useProviderStore';
import type { ProviderId } from '../types';

const PROVIDER_INFO: Record<ProviderId, { name: string; needsKey: boolean; defaultUrl: string }> = {
  openai: { name: 'OpenAI', needsKey: true, defaultUrl: 'https://api.openai.com' },
  anthropic: { name: 'Anthropic', needsKey: true, defaultUrl: 'https://api.anthropic.com' },
  ollama: { name: 'Ollama (Local)', needsKey: false, defaultUrl: 'http://localhost:11434' },
  gemini: { name: 'Google Gemini', needsKey: true, defaultUrl: '' },
  openrouter: { name: 'OpenRouter', needsKey: true, defaultUrl: 'https://openrouter.ai/api' },
  moonshot: { name: 'Moonshot', needsKey: true, defaultUrl: 'https://api.moonshot.cn' },
  custom: { name: 'Custom (OpenAI-compatible)', needsKey: true, defaultUrl: '' },
};

interface AgentSettingsProps {
  onClose: () => void;
}

export const AgentSettings: React.FC<AgentSettingsProps> = ({ onClose }) => {
  const providers = useProviderStore((s) => s.providers);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const setApiKey = useProviderStore((s) => s.setApiKey);
  const setModel = useProviderStore((s) => s.setModel);
  const setBaseUrl = useProviderStore((s) => s.setBaseUrl);

  return (
    <div className="agent-settings-overlay" onClick={onClose}>
      <div className="agent-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="agent-settings-header">
          <h3>AI Provider Settings</h3>
          <button className="agent-settings-close" onClick={onClose} type="button">
            {'\u2715'}
          </button>
        </div>
        <div className="agent-settings-body">
          {(Object.keys(PROVIDER_INFO) as ProviderId[]).map((id) => {
            const info = PROVIDER_INFO[id];
            const config = providers[id];
            return (
              <div key={id} className="agent-settings-provider">
                <div className="agent-settings-provider-header">
                  <label className="agent-settings-toggle">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => updateProvider({ id, enabled: e.target.checked })}
                    />
                    <span>{info.name}</span>
                  </label>
                </div>
                {config.enabled && (
                  <div className="agent-settings-provider-config">
                    {info.needsKey && (
                      <div className="agent-settings-field">
                        <label>API Key</label>
                        <input
                          type="password"
                          value={config.apiKey || ''}
                          onChange={(e) => setApiKey(id, e.target.value)}
                          placeholder={`Enter ${info.name} API key`}
                        />
                      </div>
                    )}
                    {(id === 'custom' || id === 'ollama') && (
                      <div className="agent-settings-field">
                        <label>Base URL</label>
                        <input
                          type="text"
                          value={config.baseUrl || info.defaultUrl}
                          onChange={(e) => setBaseUrl(id, e.target.value)}
                          placeholder={info.defaultUrl}
                        />
                      </div>
                    )}
                    <div className="agent-settings-field">
                      <label>Model</label>
                      <input
                        type="text"
                        value={config.model || ''}
                        onChange={(e) => setModel(id, e.target.value)}
                        placeholder="Model name"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
