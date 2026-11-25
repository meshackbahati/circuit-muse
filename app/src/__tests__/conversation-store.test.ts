import { describe, expect, it } from 'vitest';
import type { Message } from '../agent/types';
import { archiveable, titleFor } from '../store/useConversationStore';

function message(partial: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: partial.id ?? crypto.randomUUID(),
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

describe('conversation archive', () => {
  it('drops tool and system messages but keeps tool calls', () => {
    const kept = archiveable([
      message({ role: 'system', content: 'system prompt' }),
      message({ role: 'user', content: 'Build a blinker' }),
      message({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'get_circuit_state', arguments: '{}' },
          },
        ],
      }),
      message({ role: 'tool', content: '{"boards":[]}', toolCallId: 'call-1' }),
      message({ role: 'assistant', content: 'Done.' }),
    ]);

    expect(kept.map((entry) => entry.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(kept[1].toolCalls?.[0].function.name).toBe('get_circuit_state');
  });

  it('removes empty assistant messages', () => {
    const kept = archiveable([
      message({ role: 'user', content: 'Hello' }),
      message({ role: 'assistant', content: '   ' }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('uses the first user message as the title and truncates it', () => {
    const long = 'a'.repeat(90);
    const title = titleFor([
      message({ role: 'assistant', content: 'Welcome' }),
      message({ role: 'user', content: `  ${long}  ` }),
      message({ role: 'user', content: 'Second question' }),
    ]);
    expect(title).toHaveLength(64);
    expect(title.endsWith('...')).toBe(true);
  });

  it('falls back to a generic title without a user message', () => {
    expect(titleFor([message({ role: 'assistant', content: 'Hi' })])).toBe('Conversation');
  });
});
