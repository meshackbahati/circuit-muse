import { describe, expect, it } from 'vitest';
import { compactMessages, summarizeDropped } from '../agent/chatService';
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
