import type { ChatParams, LLMProvider, Message, StreamChunk, ToolCall } from './types';
import { createProvider } from './providers/registry';
import { resolveModel } from './providers/base';
import { useProviderStore } from '../store/useProviderStore';
import { useAgentStore } from '../store/useAgentStore';
import { AGENT_TOOLS } from './toolDefs';
import { SYSTEM_PROMPT } from './systemPrompt';
import { executeToolCall } from './toolExecutor';

// A full build-and-verify cycle takes more than a few tool rounds.
const MAX_TOOL_ITERATIONS = 30;
let activeRequest: AbortController | null = null;

function isFragment(text: string): boolean {
  const value = text.trim();
  if (value.includes('</')) return true;
  if (/\d{10,}/.test(value)) return true;
  if (value.length < 40 && value.split(/\s+/).length < 6) return true;
  return !/[.!?]$/.test(value);
}

function cleanChunk(text: string): string {
  return text.replace(/<\/?[A-Za-z][^>]*>/g, '');
}

function isTransient(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|timeout|timed out|network|fetch failed/i.test(text);
}

async function* streamWithRetry(
  provider: LLMProvider,
  params: ChatParams,
): AsyncGenerator<StreamChunk> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let yielded = false;
    try {
      for await (const chunk of provider.chatStream(params)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (!isTransient(error) || yielded || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export function abortMessage(): void {
  activeRequest?.abort();
}

export async function sendMessage(content: string): Promise<void> {
  // A stale request should never leave the Stop button controlling two chats.
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const agentStore = useAgentStore.getState();
  const providerStore = useProviderStore.getState();

  agentStore.addMessage({ role: 'user', content });

  const config = providerStore.providers[providerStore.activeProviderId];
  const provider = createProvider(config);
  if (!provider) {
    agentStore.addMessage({
      role: 'assistant',
      content: `Could not connect to ${config.name}. Please check your settings.`,
    });
    return;
  }

  let model: string;
  try {
    model = await resolveModel(provider, config.model);
  } catch (error) {
    agentStore.addMessage({
      role: 'assistant',
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  // Persist a model discovered from the API so later turns reuse the choice.
  if (config.model !== model) {
    useProviderStore.getState().setModel(config.id, model);
  }

  agentStore.setStreaming(true);

  try {
    const messages: Message[] = [
      { id: 'system', role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() },
      ...useAgentStore.getState().messages.filter(m => m.role !== 'system'),
    ];

    let iterations = 0;
    let previousCallSignature = '';
    let repeatedCalls = 0;
    let nudges = 0;
    let usedTools = false;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      let fullContent = '';
      let toolCalls: ToolCall[] = [];
      let assistantId: string | null = null;
      let lastUiUpdate = 0;

      for await (const chunk of streamWithRetry(provider, {
        messages,
        tools: AGENT_TOOLS,
        model,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        const text = cleanChunk(chunk.content || '');
        if (text) {
          fullContent += text;
          if (!assistantId) {
            assistantId = agentStore.addMessage({ role: 'assistant', content: fullContent });
            lastUiUpdate = Date.now();
          } else if (Date.now() - lastUiUpdate > 60) {
            agentStore.updateMessage(assistantId, { content: fullContent });
            lastUiUpdate = Date.now();
          }
        }
        if (chunk.toolCalls) {
          toolCalls = mergeToolCalls(toolCalls, chunk.toolCalls);
        }
      }
      if (assistantId) agentStore.updateMessage(assistantId, { content: fullContent });

      if (controller.signal.aborted) break;
      if (toolCalls.length === 0) {
        const complete = fullContent.trim() && (!usedTools || !isFragment(fullContent));
        if (complete || nudges >= 3) break;
        nudges++;
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: 'Continue. Use the tool results above and call more tools if needed. Do not stop until the circuit is complete and verified.',
          timestamp: Date.now(),
        });
        continue;
      }
      nudges = 0;
      usedTools = true;

      // Stop when the same call repeats without progress.
      const callSignature = toolCalls
        .map(tc => `${tc.function.name}:${tc.function.arguments}`)
        .join('|');
      repeatedCalls = callSignature === previousCallSignature ? repeatedCalls + 1 : 0;
      previousCallSignature = callSignature;
      if (repeatedCalls >= 2) {
        agentStore.addMessage({
          role: 'assistant',
          content: 'I repeated the same tool call without progress, so I stopped to avoid a loop. Review the last tool result or give me a different instruction.',
        });
        break;
      }

      if (assistantId) {
        agentStore.updateMessage(assistantId, { toolCalls });
      } else {
        const names = toolCalls.map(tc => tc.function.name).join(', ');
        agentStore.addMessage({ role: 'assistant', content: `Calling ${names}`, toolCalls });
      }

      // One assistant turn holds all calls, ahead of their results.
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullContent,
        toolCalls,
        timestamp: Date.now(),
      });

      for (const tc of toolCalls) {
        if (controller.signal.aborted) break;
        agentStore.setExecutingTool(tc.function.name);
        const result = await executeToolCall(tc);
        agentStore.setExecutingTool(null);
        agentStore.addMessage({
          role: 'tool',
          content: result,
          toolCallId: tc.id,
        });
        messages.push({
          id: tc.id,
          role: 'tool',
          content: result,
          toolCallId: tc.id,
          timestamp: Date.now(),
        });
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const friendly = /503|429|\b500\b/.test(errorMsg)
      ? `The model provider is busy or unavailable after retries. Choose another provider or model. ${errorMsg}`
      : `Error: ${errorMsg}`;
    agentStore.addMessage({ role: 'assistant', content: friendly });
  } finally {
    if (activeRequest === controller) {
      activeRequest = null;
      agentStore.setStreaming(false);
      agentStore.setExecutingTool(null);
    }
  }
}

function mergeToolCalls(existing: ToolCall[], incoming: Partial<ToolCall>[]): ToolCall[] {
  const result = [...existing];
  for (const inc of incoming) {
    if (inc.id) {
      const idx = result.findIndex(r => r.id === inc.id);
      if (idx >= 0) {
        result[idx] = {
          ...result[idx],
          function: {
            ...result[idx].function,
            name: inc.function?.name || result[idx].function.name,
            arguments: result[idx].function.arguments + (inc.function?.arguments || ''),
          },
        };
      } else {
        result.push(inc as ToolCall);
      }
    }
  }
  return result;
}
