export type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';

import type { LLMProvider } from '../types';

/**
 * Resolve the model for a request without assuming that any model exists by
 * default. When the caller has not chosen one, the first model advertised by
 * the provider API is used, which keeps the catalogue authoritative at runtime.
 */
export async function resolveModel(provider: LLMProvider, requested?: string): Promise<string> {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  if (!provider.listModels) {
    throw new Error('This provider cannot list models. Choose a model in AI Provider Settings.');
  }
  const models = await provider.listModels();
  if (models.length === 0) {
    throw new Error('No model is configured and the provider API returned none. Choose a model in AI Provider Settings.');
  }
  return models[0];
}

/** Parse SSE data lines from a streaming response body */
export async function* parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        yield data;
      }
    }
  }
}
