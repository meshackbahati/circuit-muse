import type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';
import { parseSSEStream, resolveModel } from './base';

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic' as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const model = await resolveModel(this, params.model);
    const systemMsg = params.messages.find(m => m.role === 'system');
    const nonSystem = params.messages.filter(m => m.role !== 'system');

    // Anthropic requires every tool_result block to follow its tool_use block
    // in the same user turn, so consecutive results are merged into one turn.
    const mappedMessages: any[] = [];
    for (const m of nonSystem) {
      if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: m.toolCallId || 'call_0',
          content: m.content,
        };
        const last = mappedMessages[mappedMessages.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
          last.content.push(block);
        } else {
          mappedMessages.push({ role: 'user', content: [block] });
        }
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const contentBlocks: any[] = [];
        if (m.content) contentBlocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          let inputObj: any = {};
          try {
            inputObj = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          } catch {
            inputObj = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: inputObj,
          });
        }
        mappedMessages.push({ role: 'assistant', content: contentBlocks });
        continue;
      }
      mappedMessages.push({ role: m.role, content: m.content || ' ' });
    }

    const body: any = {
      model,
      max_tokens: params.maxTokens || 4096,
      messages: mappedMessages,
      stream: true,
    };

    if (systemMsg) body.system = systemMsg.content;

    if (params.tools) {
      body.tools = params.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
    }

    const reader = response.body!.getReader();
    let currentToolUse: { id: string; name: string; input: string } | null = null;

    for await (const line of parseSSEStream(reader)) {
      try {
        const parsed = JSON.parse(line);
        const chunk: StreamChunk = { done: false };

        switch (parsed.type) {
          case 'content_block_start':
            if (parsed.content_block?.type === 'tool_use') {
              currentToolUse = {
                id: parsed.content_block.id,
                name: parsed.content_block.name,
                input: '',
              };
            }
            break;
          case 'content_block_delta':
            if (parsed.delta?.type === 'text_delta') {
              chunk.content = parsed.delta.text;
            } else if (parsed.delta?.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.input += parsed.delta.partial_json;
            }
            break;
          case 'content_block_stop':
            if (currentToolUse) {
              chunk.toolCalls = [{
                id: currentToolUse.id,
                type: 'function',
                function: { name: currentToolUse.name, arguments: currentToolUse.input },
              }];
              currentToolUse = null;
            }
            break;
          case 'message_stop':
            chunk.done = true;
            break;
        }

        if (chunk.content || chunk.toolCalls || chunk.done) {
          yield chunk;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.data || []).map((m: any) => m.id).filter(Boolean);
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
