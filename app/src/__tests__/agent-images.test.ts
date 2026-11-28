/**
 * Images attached in the agent chat must reach the model as image input in
 * each provider's format (they used to be reachable only as base64 text).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../agent/types';
import { buildOpenAIMessages } from '../agent/providers/base';
import { buildGeminiContents } from '../agent/providers/gemini';
import { AnthropicProvider } from '../agent/providers/anthropic';
import { imagesForNextMessage, limitImages, MAX_IMAGE_MESSAGES } from '../agent/messageImages';

const PNG = 'iVBORw0KGgo=';
const userWithImage = (id: string, text = 'what is this circuit?'): Message => ({
  id,
  role: 'user',
  content: text,
  timestamp: 0,
  images: [{ mediaType: 'image/png', data: PNG, name: `${id}.png` }],
});

afterEach(() => vi.unstubAllGlobals());

describe('image input per provider', () => {
  it('OpenAI-compatible: text plus image_url data URL', () => {
    const [msg] = buildOpenAIMessages([userWithImage('a')]);
    expect(msg.content).toEqual([
      { type: 'text', text: 'what is this circuit?' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
  });

  it('Gemini: inlineData part before the text', () => {
    const [content] = buildGeminiContents([userWithImage('a')]);
    expect(content.parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG } });
    expect(content.parts[1]).toEqual({ text: 'what is this circuit?' });
  });

  it('Anthropic: base64 image block in the request body', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: false, status: 400, text: async () => 'stop', json: async () => ({}) } as any;
    }));
    const provider = new AnthropicProvider('key');
    await expect(async () => {
      for await (const _ of provider.chatStream({ messages: [userWithImage('a')], model: 'claude-test' } as any)) {
        // consume
      }
    }).rejects.toThrow();
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG },
    });
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: 'what is this circuit?' });
  });

  it('messages without images are unchanged', () => {
    const [msg] = buildOpenAIMessages([{ id: 'x', role: 'user', content: 'hi', timestamp: 0 }]);
    expect(msg).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('image bookkeeping', () => {
  it('only unsent supported images are attached', async () => {
    const { images, ids } = await imagesForNextMessage([
      { id: '1', name: 'a.png', mime: 'image/png', size: 1, kind: 'image', dataUrl: `data:image/png;base64,${PNG}`, width: 10, height: 10 },
      { id: '2', name: 'b.png', mime: 'image/png', size: 1, kind: 'image', dataUrl: `data:image/png;base64,${PNG}`, width: 10, height: 10, sentAt: 1 },
      { id: '3', name: 'c.txt', mime: 'text/plain', size: 1, kind: 'text', text: 'x' },
    ]);
    expect(ids).toEqual(['1']);
    expect(images).toEqual([{ mediaType: 'image/png', data: PNG, name: 'a.png' }]);
  });

  it('keeps pixels only on the most recent image messages', () => {
    const history = Array.from({ length: MAX_IMAGE_MESSAGES + 2 }, (_, i) => userWithImage(`m${i}`));
    const limited = limitImages(history);
    const withPixels = limited.filter((m) => m.images?.length);
    expect(withPixels.map((m) => m.id)).toEqual(history.slice(-MAX_IMAGE_MESSAGES).map((m) => m.id));
    expect(limited[0].content).toContain('[earlier image omitted: m0.png]');
  });
});
