import type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';
import { buildOpenAIMessages, resolveModel } from './base';

export class OllamaProvider implements LLMProvider {
  id = 'ollama' as const;
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((m: any) => m.name || m.model);
    } catch {
      return [];
    }
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const model = await resolveModel(this, params.model);
    const body = {
      model,
      messages: toOllamaMessages(buildOpenAIMessages(params.messages)),
      stream: true,
      ...(params.tools && { tools: params.tools }),
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${error}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const chunk: StreamChunk = {
            content: parsed.message?.content,
            // Ollama sends complete calls without ids and with object
            // arguments; give them the shape the agent loop expects.
            toolCalls: Array.isArray(parsed.message?.tool_calls)
              ? parsed.message.tool_calls.map((tc: any, i: number) => ({
                  id: tc.id || `ollama_${Date.now().toString(36)}_${i}`,
                  type: 'function' as const,
                  function: {
                    name: tc.function?.name ?? '',
                    arguments:
                      typeof tc.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function?.arguments ?? {}),
                  },
                }))
              : undefined,
            done: parsed.done ?? false,
          };
          if (parsed.done_eval_count != null) {
            chunk.usage = {
              promptTokens: parsed.prompt_eval_count ?? 0,
              completionTokens: parsed.eval_count ?? 0,
            };
          }
          yield chunk;
        } catch {
          // skip malformed lines
        }
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
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: Date.now(),
      providerId: this.id,
    };
  }

}

/** Ollama's /api/chat takes tool call arguments as an object, not the JSON
 *  string the OpenAI format uses. */
function toOllamaMessages(messages: any[]): any[] {
  return messages.map((m) => {
    if (!Array.isArray(m.tool_calls)) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc: any) => {
        let args: unknown = tc.function?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args || '{}');
          } catch {
            args = {};
          }
        }
        return { ...tc, function: { ...tc.function, arguments: args } };
      }),
    };
  });
}
