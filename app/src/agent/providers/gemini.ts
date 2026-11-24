import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

/**
 * Build Gemini contents from the internal chat history.
 *
 * Tool results are carried as ordinary user text rather than native
 * `functionResponse` parts. Several Gemini models reject the native
 * round-trip when a signature or Struct does not match their expectations,
 * and the SDK masks the validation reason as a generic 400. Text history is
 * accepted by every model and still gives the model the result it needs to
 * continue the task.
 */
export function buildGeminiContents(messages: Message[]): any[] {
  const contents: any[] = [];
  const callNames = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.id) callNames.set(tc.id, tc.function.name);
    }
  }

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
      let text = m.content || '';
      if (m.toolCalls && m.toolCalls.length > 0) {
        const calls = m.toolCalls
          .map(tc => `${tc.function.name}(${tc.function.arguments})`)
          .join('\n');
        text = `${text}\n[Tool calls made: ${calls}]`.trim();
      }
      contents.push({ role: 'model', parts: [{ text: text || ' ' }] });
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
    } catch (error) {
      // WebKit occasionally reports a truncated stream as an incomplete JSON
      // segment. Surface a clean end instead of breaking the whole chat.
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
