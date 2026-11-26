import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

/**
 * Build Gemini contents with native function call and response parts.
 *
 * The previous implementation flattened every tool turn into plain text.
 * Gemini then saw a model message that announced a function call with no
 * matching response, so later chunks described the call in prose instead of
 * emitting another tool call. Native parts keep the call id aligned with its
 * result, which is what the model needs to continue the build loop.
 */
export function buildGeminiContents(messages: Message[]): any[] {
  const callNames = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.id) callNames.set(tc.id, tc.function.name);
    }
  }

  const contents: any[] = [];
  const emittedCallIds = new Set<string>();
  let pendingToolParts: any[] = [];

  const flushToolParts = () => {
    if (pendingToolParts.length === 0) return;
    contents.push({ role: 'user', parts: pendingToolParts });
    pendingToolParts = [];
  };

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const name = (m.toolCallId && callNames.get(m.toolCallId)) || 'tool';
      if (!m.toolCallId || !callNames.has(m.toolCallId)) {
        // An orphan result has no call id to reply to. Text is the only safe
        // representation, and the assistant side relabels it before sending.
        flushToolParts();
        contents.push({
          role: 'user',
          parts: [{ text: `Tool result (${name}):\n${m.content}` }],
        });
        continue;
      }
      pendingToolParts.push({
        functionResponse: {
          id: m.toolCallId,
          name,
          response: { result: m.content },
        },
      });
      continue;
    }

    flushToolParts();

    if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content && m.content.trim()) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        // Gemini rejects a request when the same call id appears twice in the
        // history. Older transcripts can contain repeated ids after retries.
        if (!tc.id || emittedCallIds.has(tc.id)) continue;
        emittedCallIds.add(tc.id);
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || '{}');
          if (parsed && typeof parsed === 'object') args = parsed;
        } catch {
          args = {};
        }
        const functionCall: Record<string, unknown> = {
          id: tc.id,
          name: tc.function.name,
          args,
        };
        if (tc.thoughtSignature) functionCall.thoughtSignature = tc.thoughtSignature;
        parts.push({ functionCall });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({ role: 'user', parts: [{ text: m.content || ' ' }] });
  }

  flushToolParts();
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

    const seenCalls = new Set<string>();
    try {
      for await (const chunk of response) {
        const toolCalls: ToolCall[] = [];
        for (const fc of chunk.functionCalls ?? []) {
          // Keep the id the API supplied. A generated id would not match the
          // functionResponse we send on the next turn.
          const id = (fc as any).id || crypto.randomUUID();
          if (seenCalls.has(id)) continue;
          seenCalls.add(id);
          toolCalls.push({
            id,
            type: 'function' as const,
            function: {
              name: fc.name ?? '',
              arguments: JSON.stringify(fc.args || {}),
            },
            thoughtSignature: (fc as any).thoughtSignature || (fc as any).thought_signature || undefined,
          });
        }

        yield {
          content: chunk.text || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
      if (chunk.toolCalls) toolCalls = [...toolCalls, ...(chunk.toolCalls as ToolCall[])];
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
