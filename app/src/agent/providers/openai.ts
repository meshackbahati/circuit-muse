import type { LLMProvider, ChatParams, StreamChunk, Message, ProviderId } from '../types';
import { buildOpenAIMessages, parseSSEStream, resolveModel } from './base';
import { getApiBase } from '../../lib/apiBase';

export interface OpenAICompatibleOptions {
  /**
   * Relay requests through the local engine. This exists only for NVIDIA,
   * whose API sends no CORS headers to the desktop WebView. Other providers
   * are reached directly.
   */
  nvidiaProxy?: boolean;
}

export class OpenAICompatibleProvider implements LLMProvider {
  id: ProviderId;
  private baseUrl: string;
  private apiKey: string;
  private nvidiaProxy: boolean;

  constructor(
    id: ProviderId,
    baseUrl: string,
    apiKey: string,
    options: OpenAICompatibleOptions = {},
  ) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.nvidiaProxy = options.nvidiaProxy === true;
  }

  private proxyEndpoint(kind: 'models' | 'chat'): string {
    return `${getApiBase()}/ai/nvidia/${kind}`;
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const model = await resolveModel(this, params.model);
    const body = {
      model,
      messages: buildOpenAIMessages(params.messages),
      stream: true,
      ...(params.tools && { tools: params.tools }),
      ...(params.temperature != null && { temperature: params.temperature }),
      ...(params.maxTokens != null && { max_tokens: params.maxTokens }),
    };

    const target = `${this.baseUrl}/v1/chat/completions`;
    const response = this.nvidiaProxy
      ? await fetch(this.proxyEndpoint('chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, api_key: this.apiKey, body }),
          signal: params.signal,
        })
      : await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: params.signal,
        });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.id} API error ${response.status}: ${error}`);
    }
    if (!response.body) {
      throw new Error(`${this.id} returned an empty response body`);
    }

    const reader = response.body.getReader();
    const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const line of parseSSEStream(reader)) {
      try {
        const parsed = JSON.parse(line);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        const chunk: StreamChunk = { done: choice.finish_reason === 'stop' };

        // NVIDIA reasoning models put chain-of-thought in reasoning_content.
        // It is not assistant output, so it is deliberately not forwarded.
        if (typeof delta.content === 'string' && delta.content) {
          chunk.content = delta.content;
        }

        if (delta.tool_calls) {
          chunk.toolCalls = delta.tool_calls.map((tc: any) => {
            const idx = tc.index ?? 0;
            const existing = toolCallBuffers.get(idx);
            const id = tc.id || existing?.id || '';
            const name = tc.function?.name || existing?.name || '';
            const args = tc.function?.arguments || '';
            toolCallBuffers.set(idx, {
              id,
              name,
              arguments: (existing?.arguments ?? '') + args,
            });
            const buf = toolCallBuffers.get(idx)!;
            return {
              id: buf.id,
              type: 'function' as const,
              function: { name: buf.name, arguments: buf.arguments },
            };
          });
        }

        if (parsed.usage) {
          chunk.usage = {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
          };
        }

        yield chunk;
      } catch {
        // skip malformed lines
      }
    }
  }

  async chat(params: ChatParams): Promise<Message> {
    const chunks: string[] = [];
    let toolCalls: any[] = [];
    for await (const chunk of this.chatStream(params)) {
      if (chunk.content) chunks.push(chunk.content);
      if (chunk.toolCalls) toolCalls = chunk.toolCalls;
    }
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: chunks.join(''),
      toolCalls: toolCalls.length > 0 ? (toolCalls as any[]) : undefined,
      timestamp: Date.now(),
      providerId: this.id,
    };
  }

  async listModels(): Promise<string[]> {
    const target = `${this.baseUrl}/v1/models`;
    try {
      const response = this.nvidiaProxy
        ? await fetch(this.proxyEndpoint('models'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: target, api_key: this.apiKey }),
          })
        : await fetch(target, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
          });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.data || []).map((m: any) => m.id).sort();
    } catch {
      return [];
    }
  }
}
