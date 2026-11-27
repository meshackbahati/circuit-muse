/**
 * Gemini must preserve the function call id returned by the API. The previous
 * implementation generated a new id per streamed chunk, so the function
 * response on the next turn could not be matched and the model described the
 * call in prose instead of continuing the tool loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../agent/providers/gemini';
import type { ChatParams } from '../agent/types';

const streamChunks = vi.hoisted(() => ({ value: [] as any[] }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        generateContentStream: async function* () {
          for (const chunk of streamChunks.value) yield chunk;
        },
      },
    };
  }),
}));

describe('Gemini tool calls', () => {
  beforeEach(() => {
    streamChunks.value = [];
  });

  it('preserves API call ids and ignores repeated chunks for the same call', async () => {
    streamChunks.value = [
      {
        candidates: [{
          content: {
            parts: [
              { functionCall: { id: 'call-abc', name: 'build_circuit', args: { components: [] } }, thoughtSignature: 'sig-abc' },
            ],
          },
        }],
      },
      {
        candidates: [{
          content: {
            parts: [
              { functionCall: { id: 'call-abc', name: 'build_circuit', args: { components: [] } }, thoughtSignature: 'sig-abc' },
            ],
          },
        }],
      },
    ];

    const provider = new GeminiProvider('test-key');
    const params: ChatParams = {
      messages: [{ id: '1', role: 'user', content: 'build a blink', timestamp: 0 }],
      model: 'gemini-2.5-flash',
      tools: [
        {
          type: 'function',
          function: {
            name: 'build_circuit',
            description: 'Add components and wires',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    };

    const calls = [];
    for await (const chunk of provider.chatStream(params)) {
      if (chunk.toolCalls) calls.push(...chunk.toolCalls);
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('call-abc');
    expect(calls[0].thoughtSignature).toBe('sig-abc');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ components: [] });
  });
});
