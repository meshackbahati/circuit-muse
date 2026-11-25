import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

// Plain-text tool history keeps every Gemini model on the same path.
export function buildGeminiContents(messages: Message[]): any[] {
  const callNames = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.id) callNames.set(tc.id, tc.function.name);
    }
  }

  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const name = (m.toolCallId && callNames.get(m.toolCallId)) || 'tool';
      contents.push({
        role: 'user',
        parts: [{ text: `Tool result (${name}):\n${m.content}` }],
      });
      continue;
    }

    if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: m.content || ' ' }] });
      continue;
    }

    contents.push({ role: 'user', parts: [{ text: m.content || ' ' }] });
  }

  return contents;
}

export class GeminiProvider implements LLMProvider {
  id = 'gemini' as const;
  private client: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const model = await resolveModel(this, params.model);
    const contents = buildGeminiContents(params.messages);
    const systemInstruction = params.messages.find(m => m.role === 'system')?.content;

    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (params.temperature != null) config.temperature = params.temperature;
    if (params.maxTokens != null) config.maxOutputTokens = params.maxTokens;

    if (params.tools && params.tools.length > 0) {
      config.tools = [{
        functionDeclarations: params.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    const response = await this.client.models.generateContentStream({
      model,
      contents,
      config,
    });

    try {
      for await (const chunk of response) {
        const toolCalls: ToolCall[] | undefined = chunk.functionCalls?.map(fc => ({
          id: crypto.randomUUID(),
          type: 'function' as const,
          function: {
            name: fc.name ?? '',
            arguments: JSON.stringify(fc.args || {}),
          },
          thoughtSignature: (fc as any).thoughtSignature || (fc as any).thought_signature || undefined,
        }));

        yield {
          content: chunk.text || undefined,
          toolCalls,
          done: false,
        };
      }
    } catch (error) {
      console.warn('[Gemini] stream ended with a parse error', error);
    }

    yield { done: true };
  }

  async listModels(): Promise<string[]> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || [])
        .filter((m: any) => {
          const actions: string[] | undefined = m.supportedActions;
          if (!actions) return true;
          return actions.some(a => a.includes('generateContent')) &&
            !actions.some(a => a.includes('embedContent'));
        })
        .map((m: any) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
        .sort();
    } catch {
      return [];
    }
  }

  async chat(params: ChatParams): Promise<Message> {
    const chunks: string[] = [];
    let toolCalls: ToolCall[] = [];
    for await (const chunk of this.chatStream(params)) {
      if (chunk.content) chunks.push(chunk.content);
      if (chunk.toolCalls) toolCalls = chunk.toolCalls as ToolCall[];
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
