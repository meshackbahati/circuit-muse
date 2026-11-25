import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

// Tool results need a Struct wrapper, not a bare array or string.
function asStruct(value: unknown): Record<string, unknown> {
  const convert = (input: unknown): unknown => {
    if (input === null || input === undefined) return '';
    if (typeof input === 'string') return input;
    if (typeof input === 'number' || typeof input === 'boolean') return String(input);
    if (Array.isArray(input)) return input.map(convert);
    if (typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(input as Record<string, unknown>)) {
        if (key === '$ref' || key === '$defs' || key === 'definitions') continue;
        output[key] = convert(nested);
      }
      return output;
    }
    return String(input);
  };

  const converted = convert(value);
  return converted && typeof converted === 'object' && !Array.isArray(converted)
    ? converted as Record<string, unknown>
    : { output: converted };
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return { output: content };
  }
}

function parseArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// Gemini wants native calls and responses, paired in order.
export function buildGeminiContents(messages: Message[]): any[] {
  const callNames = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.id) callNames.set(tc.id, tc.function.name);
    }
  }

  // Consume names in order so a result never lands on the wrong call.
  let pendingNames: string[] = [];
  const contents: any[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const name = pendingNames.shift() ?? (m.toolCallId ? callNames.get(m.toolCallId) : undefined);
      if (!name) {
        contents.push({ role: 'user', parts: [{ text: String(m.content) }] });
        continue;
      }
      const part = {
        functionResponse: { name, response: asStruct(parseToolResult(m.content)) },
      };
      const previous = contents[contents.length - 1];
      if (previous?.role === 'user' && previous.parts?.[0]?.functionResponse) {
        previous.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      const names: string[] = [];
      for (const tc of m.toolCalls ?? []) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: parseArguments(tc.function.arguments),
            ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
          },
        });
        names.push(tc.function.name);
      }
      if (parts.length === 0) parts.push({ text: m.content || ' ' });
      contents.push({ role: 'model', parts });
      if (names.length > 0) pendingNames = names;
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
