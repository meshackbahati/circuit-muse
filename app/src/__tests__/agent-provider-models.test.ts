/**
 * Default model choice and tool argument handling.
 *
 * When no model is picked, the first model a provider lists is used. An
 * alphabetical sort used to choose old models (Gemini returned 404 "no longer
 * available to new users"), and parameterless tools failed because Anthropic
 * streams empty arguments for them.
 */
import { describe, expect, it } from 'vitest';
import { isGeminiChatModel, sortGeminiModels } from '../agent/providers/gemini';
import { sortChatModels } from '../agent/providers/openai';
import { executeToolCall } from '../agent/toolExecutor';

describe('Gemini model list', () => {
  it('puts the newest stable flash model first', () => {
    const sorted = sortGeminiModels([
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.5-pro-preview',
      'gemini-3.5-pro',
    ]);
    expect(sorted[0]).toBe('gemini-3.5-flash');
    expect(sorted.indexOf('gemini-3.5-pro')).toBeLessThan(sorted.indexOf('gemini-3.5-pro-preview'));
    expect(sorted.indexOf('gemini-3.5-flash-lite')).toBeLessThan(sorted.indexOf('gemini-2.5-flash-lite'));
    expect(sorted[sorted.length - 1]).toBe('gemini-2.0-flash');
  });

  it('drops models that cannot chat', () => {
    expect(isGeminiChatModel('gemini-3.5-flash')).toBe(true);
    for (const name of ['embedding-001', 'gemini-embedding-001', 'aqa', 'imagen-4.0', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemma-3-4b-it']) {
      expect(isGeminiChatModel(name)).toBe(false);
    }
  });
});

describe('OpenAI-compatible model list', () => {
  it('drops non-chat models and orders newest first', () => {
    const sorted = sortChatModels([
      { id: 'babbage-002', created: 1 },
      { id: 'dall-e-3', created: 50 },
      { id: 'text-embedding-3-large', created: 60 },
      { id: 'gpt-old', created: 10 },
      { id: 'gpt-new', created: 100 },
      { id: 'whisper-1', created: 70 },
    ]);
    expect(sorted).toEqual(['gpt-new', 'gpt-old']);
  });

  it('keeps every chat model when the API gives no timestamps', () => {
    expect(sortChatModels([{ id: 'b-model' }, { id: 'a-model' }])).toEqual(['a-model', 'b-model']);
  });
});

describe('tool arguments', () => {
  const call = (args: string) =>
    executeToolCall({ id: 't', type: 'function', function: { name: 'list_available_boards', arguments: args } });

  it('treats empty arguments as an empty object', async () => {
    for (const args of ['', '   ', '{}']) {
      const result = JSON.parse(await call(args));
      expect(result.error).toBeUndefined();
    }
  });

  it('still rejects malformed arguments', async () => {
    const result = JSON.parse(await call('{"broken'));
    expect(result.error).toMatch(/Invalid tool arguments/);
  });
});
