import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';

export class GeminiProvider implements LLMProvider {
  id = 'gemini' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const model = params.model || 'gemini-2.0-flash';

    const contents = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'tool' ? 'user' : m.role as 'user' | 'model',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = params.messages.find(m => m.role === 'system')?.content;

    const config: any = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (params.temperature != null) config.temperature = params.temperature;
    if (params.maxTokens != null) config.maxOutputTokens = params.maxTokens;

    if (params.tools) {
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

      yield {
        content: text || undefined,
        toolCalls: functionCalls?.map(fc => ({
          id: crypto.randomUUID(),
          type: 'function' as const,
          function: {
            name: fc.name ?? '',
            arguments: JSON.stringify(fc.args),
          },
        })),
        done: false,
      };
    }

    yield { done: true };
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
