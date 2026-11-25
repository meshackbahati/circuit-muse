import type { Message, ToolCall } from './types';
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

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      let fullContent = '';
      let toolCalls: ToolCall[] = [];
      let assistantId: string | null = null;

      for await (const chunk of provider.chatStream({
        messages,
        tools: AGENT_TOOLS,
        model,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        if (chunk.content) {
          fullContent += chunk.content;
          if (!assistantId) {
            assistantId = agentStore.addMessage({ role: 'assistant', content: fullContent });
          } else {
            agentStore.updateMessage(assistantId, { content: fullContent });
          }
        }
        if (chunk.toolCalls) {
          toolCalls = mergeToolCalls(toolCalls, chunk.toolCalls);
        }
      }

      if (controller.signal.aborted) break;
      if (toolCalls.length === 0) {
        if (fullContent.trim() || nudges >= 2) break;
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
        agentStore.addMessage({ role: 'assistant', content: '', toolCalls });
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
    agentStore.addMessage({
      role: 'assistant',
      content: `Error: ${errorMsg}`,
    });
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
