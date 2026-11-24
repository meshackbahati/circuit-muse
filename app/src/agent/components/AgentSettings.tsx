import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useProviderStore } from '../../store/useProviderStore';
import { listProviderModels } from '../providers/registry';
import type { ProviderConfig, ProviderId } from '../types';

const PROVIDER_INFO: Record<ProviderId, { name: string; needsKey: boolean; defaultUrl: string }> = {
  openai: { name: 'OpenAI', needsKey: true, defaultUrl: 'https://api.openai.com' },
  anthropic: { name: 'Anthropic', needsKey: true, defaultUrl: 'https://api.anthropic.com' },
  ollama: { name: 'Ollama (Local)', needsKey: false, defaultUrl: 'http://localhost:11434' },
  gemini: { name: 'Google Gemini', needsKey: true, defaultUrl: '' },
  openrouter: { name: 'OpenRouter', needsKey: true, defaultUrl: 'https://openrouter.ai/api' },
  moonshot: { name: 'Moonshot', needsKey: true, defaultUrl: 'https://api.moonshot.cn' },
  nvidia: { name: 'NVIDIA NIM', needsKey: true, defaultUrl: 'https://integrate.api.nvidia.com' },
  custom: { name: 'Custom (OpenAI-compatible)', needsKey: true, defaultUrl: '' },
};

const PROVIDER_IDS = Object.keys(PROVIDER_INFO) as ProviderId[];

type ModelsState = Partial<Record<ProviderId, string[]>>;
type FlagState = Partial<Record<ProviderId, boolean>>;
type ErrorState = Partial<Record<ProviderId, string>>;

function canQuery(id: ProviderId, config: ProviderConfig): boolean {
  if (id === 'custom') return Boolean(config.baseUrl?.trim());
  if (id === 'ollama') return true;
  return Boolean(config.apiKey?.trim());
}

interface AgentSettingsProps {
  onClose: () => void;
}

export const AgentSettings: React.FC<AgentSettingsProps> = ({ onClose }) => {
  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const saveAndActivate = useProviderStore((s) => s.saveAndActivate);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const setApiKey = useProviderStore((s) => s.setApiKey);
  const setModel = useProviderStore((s) => s.setModel);
  const setBaseUrl = useProviderStore((s) => s.setBaseUrl);

  const [models, setModels] = useState<ModelsState>({});
  const [customMode, setCustomMode] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [loading, setLoading] = useState<FlagState>({});
  const [errors, setErrors] = useState<ErrorState>({});
  const [saved, setSaved] = useState(false);

  const fetchedFor = useRef<Partial<Record<ProviderId, string>>>({});
  const initialProviders = useRef(providers);
  const closeTimer = useRef<number | null>(null);

  const loadModels = useCallback(async (id: ProviderId, config: ProviderConfig, force = false) => {
    if (!canQuery(id, config)) return;
    const signature = `${config.apiKey || ''}|${config.baseUrl || ''}`;
    if (!force && fetchedFor.current[id] === signature) return;
    fetchedFor.current[id] = signature;

    setLoading(prev => ({ ...prev, [id]: true }));
    setErrors(prev => ({ ...prev, [id]: '' }));
    const found = await listProviderModels(config);
    setModels(prev => ({ ...prev, [id]: found }));
    if (found.length === 0) {
      setErrors(prev => ({ ...prev, [id]: 'No models returned. Type a model ID manually.' }));
    }
    setLoading(prev => ({ ...prev, [id]: false }));
  }, []);

  useEffect(() => {
    for (const id of PROVIDER_IDS) {
      void loadModels(id, initialProviders.current[id]);
    }
  }, [loadModels]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const handleSaveClose = () => {
    saveAndActivate(activeProviderId);
    setSaved(true);
    closeTimer.current = window.setTimeout(onClose, 800);
  };

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
          {PROVIDER_IDS.map((id) => {
            const info = PROVIDER_INFO[id];
            const config = providers[id];
            const available = models[id] || [];
            const isCustom = customMode[id] ?? (
              (available.length === 0 && !loading[id]) ||
              (Boolean(config.model) && available.length > 0 && !available.includes(config.model!))
            );
            const selectValue = isCustom ? '__custom__' : (config.model || '');

            return (
              <div key={id} className="agent-settings-provider">
                <div className="agent-settings-provider-header">
                  <label className="agent-settings-toggle">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => {
                        updateProvider({ id, enabled: e.target.checked });
                        setSaved(false);
                      }}
                    />
                    <span>{info.name}</span>
                  </label>
                  <label className="agent-settings-active">
                    <input
                      type="radio"
                      name="active-provider"
                      checked={activeProviderId === id}
                      onChange={() => {
                        setActiveProvider(id);
                        setSaved(false);
                      }}
                    />
                    Active
                  </label>
                </div>
                {config.enabled && (
                  <div className="agent-settings-provider-config">
                    {info.needsKey && (
                      <div className="agent-settings-field">
                        <label htmlFor={`agent-key-${id}`}>API Key</label>
                        <input
                          id={`agent-key-${id}`}
                          type="password"
                          value={config.apiKey || ''}
                          onChange={(e) => {
                            setApiKey(id, e.target.value);
                            setSaved(false);
                          }}
                          onBlur={() => void loadModels(id, providers[id], true)}
                          placeholder={`Enter ${info.name} API key`}
                        />
                      </div>
                    )}
                    {(id === 'custom' || id === 'ollama') && (
                      <div className="agent-settings-field">
                        <label htmlFor={`agent-url-${id}`}>Base URL</label>
                        <input
                          id={`agent-url-${id}`}
                          type="text"
                          value={config.baseUrl || info.defaultUrl}
                          onChange={(e) => {
                            setBaseUrl(id, e.target.value);
                            setSaved(false);
                          }}
                          onBlur={() => void loadModels(id, providers[id], true)}
                          placeholder={info.defaultUrl}
                        />
                      </div>
                    )}
                    <div className="agent-settings-field">
                      <label htmlFor={`agent-model-${id}`}>Model</label>
                      <div className="agent-settings-model-row">
                        <select
                          id={`agent-model-${id}`}
                          value={selectValue}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '__custom__') {
                              setCustomMode(prev => ({ ...prev, [id]: true }));
                            } else {
                              setCustomMode(prev => ({ ...prev, [id]: false }));
                              setModel(id, value);
                            }
                            setSaved(false);
                          }}
                        >
                          {!config.model && !isCustom && <option value="">Select a model</option>}
                          {available.map(model => <option key={model} value={model}>{model}</option>)}
                          <option value="__custom__">Type a model ID manually</option>
                        </select>
                        <button
                          type="button"
                          className="agent-settings-refresh"
                          onClick={() => void loadModels(id, providers[id], true)}
                          disabled={Boolean(loading[id]) || !canQuery(id, config)}
                          title="Fetch available models from the provider API"
                          aria-label={`Refresh ${info.name} models`}
                        >
                          {loading[id] ? '\u2026' : '\u21BB'}
                        </button>
                      </div>
                      {isCustom && (
                        <input
                          id={`agent-model-custom-${id}`}
                          type="text"
                          value={config.model || ''}
                          onChange={(e) => {
                            setModel(id, e.target.value);
                            setSaved(false);
                          }}
                          placeholder="Model ID, for example gemini-4-argon"
                          autoComplete="off"
                        />
                      )}
                      <span className="agent-settings-hint">
                        {loading[id]
                          ? 'Loading models from the provider API\u2026'
                          : errors[id]
                            ? errors[id]
                            : available.length > 0
                              ? `${available.length} models available from the provider API`
                              : 'Enter a model ID manually'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="agent-settings-save-active"
                      onClick={() => {
                        saveAndActivate(id, {
                          model: config.model?.trim() ? config.model.trim() : (available[0] || ''),
                        });
                        setSaved(true);
                      }}
                    >
                      Save &amp; Set as Active
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="agent-settings-footer">
          {saved && <span className="agent-settings-saved">{'\u2713'} Settings Saved</span>}
          <button type="button" className="agent-settings-done" onClick={handleSaveClose}>
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};
