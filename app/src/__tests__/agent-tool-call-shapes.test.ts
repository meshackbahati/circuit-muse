/**
 * Every provider streams tool calls differently. These replay each shape
 * through the same merge and normalisation the agent loop uses.
 */
import { describe, expect, it } from 'vitest';
import { mergeToolCalls, normalizeToolArguments, normalizeToolCall } from '../agent/chatService';
import { buildOpenAIMessages } from '../agent/providers/base';
import { executeToolCall } from '../agent/toolExecutor';
import type { Message, ToolCall } from '../agent/types';

const finish = (calls: ToolCall[]) => calls.map(normalizeToolCall);

describe('tool call shapes from each provider', () => {
  it('Anthropic: a tool without parameters arrives with empty arguments', async () => {
    const calls = finish(mergeToolCalls([], [
      { id: 'toolu_1', type: 'function', function: { name: 'get_circuit_state', arguments: '' } },
    ]));
    expect(calls[0].function.arguments).toBe('{}');
    const result = JSON.parse(await executeToolCall(calls[0]));
    expect(result.error).toBeUndefined();
  });

  it('OpenAI-compatible: cumulative argument buffers are not appended twice', () => {
    // The adapter re-sends the whole buffer on every delta.
    let calls: ToolCall[] = [];
    for (const buffer of ['{"bo', '{"board_id":', '{"board_id":"uno"}']) {
      calls = mergeToolCalls(calls, [{ id: 'call_1', type: 'function', function: { name: 'read_code', arguments: buffer } }]);
    }
    calls = finish(calls);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ board_id: 'uno' });
  });

  it('Gemini: complete calls pass through unchanged', () => {
    const call: ToolCall = { id: 'g1', type: 'function', function: { name: 'check_wiring', arguments: '{"include_wires":false}' } };
    expect(finish(mergeToolCalls([], [call]))[0]).toEqual(call);
  });

  it('Ollama: calls without an id are kept and object arguments become JSON', () => {
    const calls = finish(mergeToolCalls([], [
      { type: 'function', function: { name: 'list_available_boards', arguments: '' } } as Partial<ToolCall>,
      { type: 'function', function: { name: 'get_pin_names', arguments: { board: 'uno' } as unknown as string } } as Partial<ToolCall>,
    ]));
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.id)).toBe(true);
    expect(calls[0].function.arguments).toBe('{}');
    expect(JSON.parse(calls[1].function.arguments)).toEqual({ board: 'uno' });
  });

  it('never sends an empty arguments string back to OpenAI-compatible APIs', () => {
    const history: Message[] = [
      { id: 'a', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 'c', type: 'function', function: { name: 'get_circuit_state', arguments: '' } }] },
      { id: 'r', role: 'tool', content: '{}', toolCallId: 'c', timestamp: 0 },
    ];
    expect(buildOpenAIMessages(history)[0].tool_calls[0].function.arguments).toBe('{}');
  });

  it('normalises every argument form', () => {
    expect(normalizeToolArguments(undefined)).toBe('{}');
    expect(normalizeToolArguments('   ')).toBe('{}');
    expect(normalizeToolArguments({ a: 1 })).toBe('{"a":1}');
    expect(normalizeToolArguments('{"a":1}')).toBe('{"a":1}');
  });
});
