import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

/** Gemini requires a Struct, so every result is wrapped and made JSON-safe. */
function asStruct(value: unknown): Record<string, unknown> {
  const convert = (input: unknown): unknown => {
    if (input === null || input === undefined) return '';
    if (typeof input === 'string') return input;
    if (typeof input === 'number' || typeof input === 'boolean') return String(input);
    if (Array.isArray(input)) return input.map(convert);
    if (typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(input as Record<string, unknown>)) {
        // Ordinary tool data may contain JSON Schema references, which Gemini
        // interprets as multimodal references and rejects with a 400.
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

    const toolCallMap = new Map<string, string>();
    for (const msg of params.messages) {
      for (const tc of msg.toolCalls ?? []) {
        if (tc.id) toolCallMap.set(tc.id, tc.function.name);
      }
    }

    // Function responses are paired with the function calls of the preceding
    // model turn in order, so no lookup can silently produce a wrong name.
    let pendingNames: string[] = [];
    const contents: any[] = [];

    for (const m of params.messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        const name = pendingNames.shift() ?? (m.toolCallId ? toolCallMap.get(m.toolCallId) : undefined);
        if (!name) {
          contents.push({ role: 'user', parts: [{ text: String(m.content) }] });
          continue;
        }
        const part = {
          functionResponse: {
            name,
            response: asStruct(parseToolResult(m.content)),
          },
        };
        const last = contents[contents.length - 1];
        if (last?.role === 'user' && last.parts?.[0]?.functionResponse) {
          last.parts.push(part);
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

    for await (const chunk of response) {
      const text = chunk.text;
      const functionCalls = chunk.functionCalls;

      const toolCalls: ToolCall[] | undefined = functionCalls?.map(fc => ({
        id: crypto.randomUUID(),
        type: 'function' as const,
        function: {
          name: fc.name ?? '',
          arguments: JSON.stringify(fc.args || {}),
        },
        thoughtSignature: (fc as any).thoughtSignature || (fc as any).thought_signature || undefined,
      }));

      yield {
        content: text || undefined,
        toolCalls,
        done: false,
      };
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
