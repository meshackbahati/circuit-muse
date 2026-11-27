import { describe, expect, it } from 'vitest';
import { compactMessages, minimalTranscript, repairToolPairs, summarizeDropped } from '../agent/chatService';
import type { Message } from '../agent/types';

const message = (role: Message['role'], content: string, id = String(Math.random())): Message => ({
  id,
  role,
  content,
  timestamp: 0,
});

describe('chat history compaction', () => {
  it('summarises wiring, compile and serial evidence from dropped turns', () => {
    const summary = summarizeDropped([
      message('tool', JSON.stringify({ complete: false, blocking_issues: [{ reason: 'LED C is unwired' }] })),
      message('tool', JSON.stringify({ success: true, board_id: 'uno' })),
      message('tool', JSON.stringify({ serial_output: 'blink on\nblink off' })),
    ]);
    expect(summary).toContain('wiring complete: false');
    expect(summary).toContain('LED C is unwired');
    expect(summary).toContain('compile success: true');
    expect(summary).toContain('blink on');
  });

  it('keeps a bounded transcript with the system message first and a summary second', () => {
    const messages: Message[] = [message('system', 'system prompt', 'sys')];
    for (let i = 0; i < 30; i++) messages.push(message('user', `turn ${i}`));

    compactMessages(messages);

    expect(messages.length).toBeLessThanOrEqual(21);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('Earlier session summary');
  });

  it('does not compact a short transcript', () => {
    const messages = [message('system', 's', 'sys'), message('user', 'hello')];
    compactMessages(messages);
    expect(messages).toHaveLength(2);
  });
});

const call = (id: string, name = 'get_simulation_output') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: '{}' },
});
const assistantCalls = (...ids: string[]): Message => ({
  id: `a-${ids.join('-')}`,
  role: 'assistant',
  content: '',
  toolCalls: ids.map((id) => call(id)),
  timestamp: 0,
});
const result = (id: string): Message => ({
  id: `r-${id}`,
  role: 'tool',
  content: '{"success":true}',
  toolCallId: id,
  timestamp: 0,
});

/** Every tool result must directly follow the assistant turn that called it,
 *  and every call must have a result. This is what Anthropic and OpenAI check. */
function expectValidToolPairs(messages: Message[]) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const ids = m.toolCalls.map((tc) => tc.id);
      const following: string[] = [];
      for (let j = i + 1; j < messages.length && messages[j].role === 'tool'; j++) {
        following.push(messages[j].toolCallId!);
      }
      expect(following.sort()).toEqual([...ids].sort());
    }
    if (m.role === 'tool') {
      let k = i - 1;
      while (k >= 0 && messages[k].role === 'tool') k--;
      expect(messages[k]?.role).toBe('assistant');
      expect(messages[k].toolCalls?.map((tc) => tc.id)).toContain(m.toolCallId);
    }
  }
}

describe('tool call pairing', () => {
  it('never leaves a tool result without its call after compaction', () => {
    // A long tool session where the plain cut point lands on a tool result:
    // the bug that produced "unexpected tool_use_id found in tool_result blocks".
    for (let offset = 0; offset < 6; offset++) {
      const messages: Message[] = [message('system', 's', 'sys'), message('user', 'build a traffic light')];
      for (let i = 0; i < offset; i++) messages.push(message('user', `note ${i}`));
      for (let round = 0; round < 10; round++) {
        messages.push(assistantCalls(`c${round}a`, `c${round}b`), result(`c${round}a`), result(`c${round}b`));
      }
      compactMessages(messages);
      expect(messages[0].role).toBe('system');
      expect(messages[1].content).toContain('Earlier session summary');
      expect(messages[2].role).not.toBe('tool');
      expectValidToolPairs(messages);
    }
  });

  it('removes orphan results and strips unanswered calls', () => {
    const messages: Message[] = [
      message('system', 's', 'sys'),
      result('lost'),
      message('user', 'go'),
      { ...assistantCalls('done', 'aborted'), content: 'Checking' },
      result('done'),
      assistantCalls('never-answered'),
    ];
    repairToolPairs(messages);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(messages[2].toolCalls?.map((tc) => tc.id)).toEqual(['done']);
    expectValidToolPairs(messages);
  });

  it('keeps an assistant message with text when none of its calls were answered', () => {
    const messages: Message[] = [message('user', 'go'), { ...assistantCalls('x'), content: 'Let me check.' }];
    repairToolPairs(messages);
    expect(messages).toHaveLength(2);
    expect(messages[1].toolCalls).toBeUndefined();
    expect(messages[1].content).toBe('Let me check.');
  });

  it('leaves a valid transcript untouched', () => {
    const messages: Message[] = [message('user', 'go'), assistantCalls('a'), result('a'), message('assistant', 'Done.')];
    const before = [...messages];
    repairToolPairs(messages);
    expect(messages).toEqual(before);
  });

  it('minimal retry transcript keeps the last request and a complete tool round', () => {
    const messages: Message[] = [
      message('system', 's', 'sys'),
      message('user', 'build it'),
      assistantCalls('a1'),
      result('a1'),
      assistantCalls('b1', 'b2'),
      result('b1'),
      result('b2'),
    ];
    const minimal = minimalTranscript(messages);
    expect(minimal.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(minimal[1].content).toBe('build it');
    expectValidToolPairs(minimal);
  });
});
