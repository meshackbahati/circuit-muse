import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderId, ProviderConfig } from '../agent/types';
import { PROVIDER_DEFAULTS } from '../agent/providers/registry';

interface ProviderState {
  providers: Record<ProviderId, ProviderConfig>;
  activeProviderId: ProviderId;
  setActiveProvider: (id: ProviderId) => void;
  saveAndActivate: (id: ProviderId, patch?: Partial<ProviderConfig>) => void;
  updateProvider: (patch: Partial<ProviderConfig> & { id: ProviderId }) => void;
  setApiKey: (providerId: ProviderId, key: string) => void;
  setModel: (providerId: ProviderId, model: string) => void;
  setBaseUrl: (providerId: ProviderId, url: string) => void;
}

const defaultProviders: Record<ProviderId, ProviderConfig> = {
  openai: { id: 'openai', name: 'OpenAI', enabled: false, ...PROVIDER_DEFAULTS.openai },
  anthropic: { id: 'anthropic', name: 'Anthropic', enabled: false, ...PROVIDER_DEFAULTS.anthropic },
  ollama: { id: 'ollama', name: 'Ollama (Local)', enabled: true, ...PROVIDER_DEFAULTS.ollama },
  gemini: { id: 'gemini', name: 'Google Gemini', enabled: false, ...PROVIDER_DEFAULTS.gemini },
  openrouter: { id: 'openrouter', name: 'OpenRouter', enabled: false, ...PROVIDER_DEFAULTS.openrouter },
  moonshot: { id: 'moonshot', name: 'Moonshot', enabled: false, ...PROVIDER_DEFAULTS.moonshot },
  nvidia: { id: 'nvidia', name: 'NVIDIA NIM', enabled: false, ...PROVIDER_DEFAULTS.nvidia },
  custom: { id: 'custom', name: 'Custom (OpenAI-compatible)', enabled: false, isCustom: true, ...PROVIDER_DEFAULTS.custom },
};

export const useProviderStore = create<ProviderState>()(
  persist(
    (set) => ({
      providers: defaultProviders,
      activeProviderId: 'ollama',
      setActiveProvider: (id) => set((state) => ({
        activeProviderId: id,
        providers: {
          ...state.providers,
          [id]: { ...state.providers[id], enabled: true },
        },
      })),
      saveAndActivate: (id, patch) => set((state) => ({
        activeProviderId: id,
        providers: {
          ...state.providers,
          [id]: {
            ...state.providers[id],
            ...(patch || {}),
            enabled: true,
          },
        },
      })),
      updateProvider: (patch) => set((state) => ({
        providers: {
          ...state.providers,
          [patch.id]: { ...state.providers[patch.id], ...patch },
        },
      })),
      setApiKey: (providerId, key) => set((state) => ({
        providers: {
          ...state.providers,
          [providerId]: {
            ...state.providers[providerId],
            apiKey: key,
            enabled: key.trim().length > 0 ? true : state.providers[providerId].enabled,
          },
        },
      })),
      setModel: (providerId, model) => set((state) => ({
        providers: {
          ...state.providers,
          [providerId]: { ...state.providers[providerId], model },
        },
      })),
      setBaseUrl: (providerId, url) => set((state) => ({
        providers: {
          ...state.providers,
          [providerId]: { ...state.providers[providerId], baseUrl: url },
        },
      })),
    }),
    { name: 'circuit-muse-providers' }
  )
);
