import type { LLMProvider, ChatParams, StreamChunk, Message } from '../types';
import { parseSSEStream } from './base';

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic' as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const systemMsg = params.messages.find(m => m.role === 'system');
    const nonSystem = params.messages.filter(m => m.role !== 'system');

    const body: any = {
      model: params.model || 'claude-sonnet-4-20250514',
      max_tokens: params.maxTokens || 4096,
      messages: nonSystem.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
          : m.content,
      })),
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
