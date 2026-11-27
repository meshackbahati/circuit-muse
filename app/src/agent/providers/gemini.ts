import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatParams, StreamChunk, Message, ToolCall } from '../types';
import { resolveModel } from './base';

/**
 * Build Gemini contents with native function call and response parts.
 *
 * The previous implementation flattened every tool turn into plain text, so
 * Gemini saw a call with no response and described the call in prose. The
 * current form keeps native parts, and more importantly guarantees that the
 * number of function response parts equals the number of function call parts.
 * Gemini rejects the whole request when those counts differ, which surfaced
 * as an HTTP 400 with the masked message "exception parsing response".
 */
export function buildGeminiContents(messages: Message[]): any[] {
  const callNames = new Map<string, string>();
  const answeredCallIds = new Set<string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.id && !callNames.has(tc.id)) callNames.set(tc.id, tc.function.name);
    }
    if (m.role === 'tool' && m.toolCallId) answeredCallIds.add(m.toolCallId);
  }

  // Only calls that have a matching tool result may be sent. A call without a
  // result (for example an aborted tool) must not create a response mismatch.
  const emittableCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const tc of m.toolCalls ?? []) {
      if (tc.id && answeredCallIds.has(tc.id) && !emittableCallIds.has(tc.id)) {
        emittableCallIds.add(tc.id);
      }
    }
  }

  const contents: any[] = [];
  const emittedCallIds = new Set<string>();
  const emittedResponseIds = new Set<string>();
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
      if (
        !m.toolCallId ||
        !emittableCallIds.has(m.toolCallId) ||
        emittedResponseIds.has(m.toolCallId)
      ) {
        // A result whose call was skipped, duplicated or never sent has no
        // function response part to pair with. Plain text keeps the evidence
        // without breaking the call and response count invariant.
        flushToolParts();
        contents.push({
          role: 'user',
          parts: [{ text: `Tool result (${name}):\n${m.content}` }],
        });
        continue;
      }
      emittedResponseIds.add(m.toolCallId);
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
        if (!tc.id || !emittableCallIds.has(tc.id) || emittedCallIds.has(tc.id)) continue;
        emittedCallIds.add(tc.id);
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || '{}');
          if (parsed && typeof parsed === 'object') args = parsed;
        } catch {
          args = {};
        }
        // Gemini 3 requires the opaque thought signature from the original
        // call to be echoed on the same Part when the call is replayed. The
        // SDK models it on Part, not inside FunctionCall.
        const part: Record<string, unknown> = {
          functionCall: { id: tc.id, name: tc.function.name, args },
        };
        if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
        parts.push(part);
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
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          const fc = part.functionCall;
          if (!fc) continue;
          // Keep the id the API supplied. A generated id would not match the
          // functionResponse sent on the next turn.
          const id = fc.id || crypto.randomUUID();
          if (seenCalls.has(id)) continue;
          seenCalls.add(id);
          toolCalls.push({
            id,
            type: 'function' as const,
            function: {
              name: fc.name ?? '',
              arguments: JSON.stringify(fc.args || {}),
            },
            thoughtSignature: (part as any).thoughtSignature || undefined,
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
      return sortGeminiModels(
        (data.models || [])
          .filter((m: any) => {
            // The API field is supportedGenerationMethods; supportedActions is
            // kept for older proxies. Without this filter embedding, image and
            // speech models were offered as chat models.
            const methods: string[] | undefined = m.supportedGenerationMethods ?? m.supportedActions;
            if (methods && !methods.some((a) => a.includes('generateContent'))) return false;
            return true;
          })
          .map((m: any) => String(m.name || '').replace(/^models\//, ''))
          .filter(isGeminiChatModel),
      );
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

/** Chat-capable Gemini models. Image, speech, embedding and live-audio
 *  variants cannot run the agent's tool loop. */
export function isGeminiChatModel(name: string): boolean {
  if (!/^gemini-/.test(name)) return false;
  return !/(embedding|image|tts|audio|live|vision-only|aqa|robotics|computer-use)/i.test(name);
}

function geminiVersion(name: string): number {
  const match = /^gemini-(\d+(?:\.\d+)?)/.exec(name);
  return match ? parseFloat(match[1]) : 0;
}

/** Newest version first, stable before preview or experimental, then flash
 *  before pro before lite. The first entry is used when the user has not
 *  picked a model, so an alphabetical sort used to choose an old model that
 *  Google may already have retired for new keys. */
export function sortGeminiModels(names: string[]): string[] {
  const unstable = (n: string) => (/(preview|exp|latest)/i.test(n) ? 1 : 0);
  const tier = (n: string) => (/flash-lite/i.test(n) ? 2 : /flash/i.test(n) ? 0 : /pro/i.test(n) ? 1 : 3);
  return [...new Set(names)].sort(
    (a, b) =>
      geminiVersion(b) - geminiVersion(a) ||
      unstable(a) - unstable(b) ||
      tier(a) - tier(b) ||
      a.localeCompare(b),
  );
}
