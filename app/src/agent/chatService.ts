import type { Message, ToolCall } from './types';
import { createProvider } from './providers/registry';
import { useProviderStore } from '../store/useProviderStore';
import { useAgentStore } from '../store/useAgentStore';
import { AGENT_TOOLS } from './toolDefs';
import { SYSTEM_PROMPT } from './systemPrompt';
import { executeToolCall } from './toolExecutor';

const MAX_TOOL_ITERATIONS = 10;

export async function sendMessage(content: string): Promise<void> {
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

  agentStore.setStreaming(true);

  try {
    const messages: Message[] = [
      { id: 'system', role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() },
      ...useAgentStore.getState().messages.filter(m => m.role !== 'system'),
    ];

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      let fullContent = '';
      let toolCalls: ToolCall[] = [];

      for await (const chunk of provider.chatStream({
        messages,
        tools: AGENT_TOOLS,
        model: config.model,
      })) {
        if (chunk.content) {
          fullContent += chunk.content;
          agentStore.updateLastAssistantMessage(fullContent);
          const msgs = useAgentStore.getState().messages;
          const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            agentStore.addMessage({ role: 'assistant', content: fullContent });
          }
        }
        if (chunk.toolCalls) {
          toolCalls = mergeToolCalls(toolCalls, chunk.toolCalls);
        }
      }

      if (toolCalls.length === 0) break;

      if (fullContent) {
        // Already added via updateLastAssistantMessage
      } else {
        agentStore.addMessage({ role: 'assistant', content: '', toolCalls });
      }

      for (const tc of toolCalls) {
        agentStore.setExecutingTool(tc.function.name);
        const result = await executeToolCall(tc);
        agentStore.addMessage({
          role: 'tool',
          content: result,
          toolCallId: tc.id,
        });
        agentStore.setExecutingTool(null);

        messages.push({
          id: tc.id,
          role: 'assistant',
          content: fullContent,
          toolCalls: [tc],
          timestamp: Date.now(),
        });
        messages.push({
          id: crypto.randomUUID(),
          role: 'tool',
          content: result,
          toolCallId: tc.id,
          timestamp: Date.now(),
        });
      }

      iterations++;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    agentStore.addMessage({
      role: 'assistant',
      content: `Error: ${errorMsg}`,
    });
  } finally {
    agentStore.setStreaming(false);
    agentStore.setExecutingTool(null);
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
