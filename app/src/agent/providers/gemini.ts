import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';
import { resolveModel } from './base';

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
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.id) toolCallMap.set(tc.id, tc.function.name);
        }
      }
    }

    const mapped = params.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          let responseObj: any = m.content;
          try {
            responseObj = JSON.parse(m.content);
          } catch {
            responseObj = { output: m.content };
          }
          const callName = (m.toolCallId && toolCallMap.get(m.toolCallId)) || 'tool_response';
          return {
            role: 'user',
            parts: [{
              functionResponse: {
                name: callName,
                response: typeof responseObj === 'object' && responseObj !== null ? responseObj : { output: responseObj },
              },
            }],
          };
        }

        if (m.role === 'assistant') {
          const parts: any[] = [];
          if (m.content) parts.push({ text: m.content });
          if (m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              let argsObj: any = {};
              try {
                argsObj = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
              } catch {
                argsObj = {};
              }
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: argsObj,
                },
              });
            }
          }
          return {
            role: 'model',
            parts: parts.length > 0 ? parts : [{ text: m.content || ' ' }],
          };
        }

        return {
          role: 'user',
          parts: [{ text: m.content || ' ' }],
        };
      });

    // Gemini expects the function responses for one model turn in a single
    // user content, so consecutive tool results are merged into one turn.
    const contents: any[] = [];
    for (const content of mapped) {
      const previous = contents[contents.length - 1];
      const isResponse = Boolean(content.parts?.[0]?.functionResponse);
      if (isResponse && previous?.role === 'user' && previous.parts?.[0]?.functionResponse) {
        previous.parts.push(...content.parts);
      } else {
        contents.push(content);
      }
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

      yield {
        content: text || undefined,
        toolCalls: functionCalls?.map(fc => ({
          id: crypto.randomUUID(),
          type: 'function' as const,
          function: {
            name: fc.name ?? '',
            arguments: JSON.stringify(fc.args || {}),
          },
        })),
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
        .map((m: any) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
    } catch {
      return [];
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
