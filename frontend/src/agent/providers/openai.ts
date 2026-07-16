import type { LLMProvider, ChatParams, StreamChunk, Message, ProviderId } from '../types';
import { parseSSEStream } from './base';

export class OpenAICompatibleProvider implements LLMProvider {
  id: ProviderId;
  private baseUrl: string;
  private apiKey: string;

  constructor(id: ProviderId, baseUrl: string, apiKey: string) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const body = {
      model: params.model || 'gpt-4o-mini',
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      })),
      stream: true,
      ...(params.tools && { tools: params.tools }),
      ...(params.temperature != null && { temperature: params.temperature }),
      ...(params.maxTokens != null && { max_tokens: params.maxTokens }),
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
      throw new Error(`OpenAI API error ${response.status}: ${error}`);
    }

    const reader = response.body!.getReader();
    const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const line of parseSSEStream(reader)) {
      try {
        const parsed = JSON.parse(line);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        const chunk: StreamChunk = { done: choice.finish_reason === 'stop' };

        if (delta.content) {
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
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
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
