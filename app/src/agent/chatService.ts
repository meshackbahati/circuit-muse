import type { ChatParams, LLMProvider, Message, StreamChunk, ToolCall } from './types';
import { createProvider } from './providers/registry';
import { resolveModel } from './providers/base';
import { useProviderStore } from '../store/useProviderStore';
import { useAgentStore } from '../store/useAgentStore';
import { useConversationStore } from '../store/useConversationStore';
import { AGENT_TOOLS } from './toolDefs';
import { SYSTEM_PROMPT } from './systemPrompt';
import { executeToolCall } from './toolExecutor';
import { auditWiring } from './wiringAudit';

// A full build-and-verify cycle takes more than a few tool rounds.
const MAX_TOOL_ITERATIONS = 30;
// Hosted providers occasionally return 503 while a safety screen or a worker
// restarts. Five attempts with exponential backoff ride out those windows.
const MAX_STREAM_ATTEMPTS = 5;
const RETRY_BASE_MS = 700;
const RETRY_MAX_MS = 8000;
const MAX_VERIFICATION_NUDGES = 3;
/** Provider requests above this many messages risk an HTTP 400 with a
 *  non-JSON body. Older turns are summarised rather than silently dropped. */
const MAX_PROVIDER_MESSAGES = 20;
const MAX_TOOL_RESULT_CHARS = 16_000;
const COMPACTION_PREFIX = 'Earlier session summary:';
let activeRequest: AbortController | null = null;

/** Turn tool results into a short factual summary. The live stores remain the
 *  source of truth for the completion gate, so this only preserves context. */
export function summarizeDropped(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      let data: any = null;
      try {
        data = JSON.parse(message.content);
      } catch {
        continue;
      }
      if (!data || typeof data !== 'object') continue;
      if (data.complete !== undefined) {
        lines.push(`wiring complete: ${data.complete}`);
        for (const issue of (data.blocking_issues ?? []).slice(0, 3)) {
          lines.push(`wiring issue: ${String(issue.reason ?? '').slice(0, 160)}`);
        }
      }
      if (data.success !== undefined && (data.board_id !== undefined || data.boards !== undefined)) {
        lines.push(`compile success: ${data.success}`);
        if (!data.success) lines.push(`compile error: ${String(data.error ?? '').slice(0, 200)}`);
      }
      if (typeof data.serial_output === 'string' && data.serial_output.trim()) {
        lines.push(`serial output: ${data.serial_output.trim().slice(0, 240)}`);
      }
      if (message.content.startsWith(COMPACTION_PREFIX)) {
        lines.push(message.content.slice(0, 800));
      }
      continue;
    }
    if (message.role === 'assistant' && message.content.trim()) {
      lines.push(`assistant said: ${message.content.trim().slice(0, 200)}`);
    }
  }
  const unique = [...new Set(lines)];
  const summary = unique.join('\n').slice(0, 2400);
  return `${COMPACTION_PREFIX}\n${summary || 'No prior tool evidence was recorded.'}\nUse the current tool results and live circuit state as the source of truth.`;
}

/** Keep a bounded provider transcript by replacing the oldest turns with a
 *  factual summary. The full transcript stays in the UI and saved project. */
export function compactMessages(messages: Message[]): void {
  if (messages.length <= MAX_PROVIDER_MESSAGES) return;
  const dropped = messages.splice(1, messages.length - MAX_PROVIDER_MESSAGES);
  const summary = summarizeDropped(dropped);
  messages.splice(1, 0, {
    id: `compaction-${Date.now()}`,
    role: 'user',
    content: summary,
    timestamp: Date.now(),
  });
}

/** Tools that change the canvas or the firmware. A turn that used one of
 *  these must end with a wiring audit, a successful compile and an observed
 *  run before the agent is allowed to report completion. */
const MUTATION_TOOLS = new Set([
  'add_board',
  'remove_board',
  'add_component',
  'build_circuit',
  'remove_component',
  'set_component_property',
  'wire_components',
  'remove_wire',
  'update_code',
  'compile_code',
  'compile_all_code',
  'reset_simulation',
]);

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
  return /\b(408|425|429|500|502|503|504)\b|content safety|timeout|timed out|network|fetch failed|load failed/i.test(text);
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function* streamWithRetry(
  provider: LLMProvider,
  params: ChatParams,
): AsyncGenerator<StreamChunk> {
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    let yielded = false;
    try {
      for await (const chunk of provider.chatStream(params)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      const retryable =
        isTransient(error) &&
        !yielded &&
        attempt < MAX_STREAM_ATTEMPTS - 1 &&
        !params.signal?.aborted;
      if (!retryable) throw error;

      const delayMs =
        Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt) +
        Math.floor(Math.random() * 250);
      useAgentStore
        .getState()
        .setRetryNotice(
          `Provider busy or unavailable. Retrying in ${(delayMs / 1000).toFixed(1)}s ` +
            `(attempt ${attempt + 2} of ${MAX_STREAM_ATTEMPTS}).`,
        );
      try {
        await sleep(delayMs, params.signal);
      } finally {
        useAgentStore.getState().setRetryNotice(null);
      }
    }
  }
}

export function abortMessage(): void {
  const controller = activeRequest;
  if (!controller) return;
  controller.abort();
  // Stop must be visible immediately. Waiting for the current compile or
  // install call to return made the button look dead for many seconds.
  const store = useAgentStore.getState();
  store.setStreaming(false);
  store.setExecutingTool(null);
  store.setRetryNotice(null);
}

interface RunProgress {
  usedMutation: boolean;
  wiringComplete: boolean | null;
  compiled: boolean;
  /** Source changed after the last successful compile, so any compiled image
   *  still on a board is stale and must not be treated as verified firmware. */
  codeDirty: boolean;
  ran: boolean;
  serialRead: boolean;
  lastSerial: string;
  lastSerialLength: number;
  lastCompileError: string | null;
}

/**
 * Refuse to let the model declare victory after a partial build. The check is
 * derived from the live stores, not from the model's own claim, so a turn that
 * stopped after writing code but before wiring or running is sent back to the
 * build loop with the exact missing step.
 */
async function completionNudge(progress: RunProgress): Promise<string | null> {
  if (!progress.usedMutation) return null;

  const { useSimulatorStore } = await import('../store/useSimulatorStore');
  const { useEditorStore } = await import('../store/useEditorStore');
  const { isPiBoardKind } = await import('../types/board');
  const sim = useSimulatorStore.getState();
  const editor = useEditorStore.getState();

  const audit = auditWiring({
    boards: sim.boards.map((b) => ({ id: b.id, boardKind: b.boardKind, name: b.name })),
    components: sim.components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      properties: c.properties ?? {},
    })),
    wires: sim.wires,
  });

  if (!audit.complete) {
    return [
      'The circuit is not finished. The wiring audit still reports blocking issues:',
      ...audit.blocking_issues.map((issue) => `- ${issue.reason}`),
      'Call check_wiring, then use wire_components or build_circuit to connect every listed pin. Do not compile until the audit reports complete true.',
    ].join('\n');
  }

  const compileTargets = sim.boards.filter(
    (board) =>
      !isPiBoardKind(board.boardKind) &&
      board.languageMode !== 'micropython' &&
      !board.compiledProgram,
  );
  if (compileTargets.length > 0) {
    const missingSource = compileTargets.filter((board) => {
      const group = editor.fileGroups[board.activeFileGroupId] ?? [];
      const source = group.length > 0 ? group : editor.files;
      return !source.some((file) => file.content.trim().length > 0);
    });
    if (missingSource.length > 0) {
      return `The wiring is complete, but ${missingSource
        .map((board) => board.id)
        .join(', ')} has no firmware. Call update_code with a complete sketch, then compile_code.`;
    }
    if (progress.lastCompileError) {
      return `The last compile failed: ${progress.lastCompileError}. Fix the reported line with update_code and compile again.`;
    }
    return `The wiring is complete, but ${compileTargets
      .map((board) => board.id)
      .join(', ')} has no compiled firmware. Call compile_code (or compile_all_code for several boards) now.`;
  }

  if (progress.codeDirty) {
    return 'Firmware source changed after the last successful compile. Call compile_code (or compile_all_code) again before running, so the simulation boots the new code rather than the previous image.';
  }

  const hasFirmware = sim.boards.some((board) => Boolean(board.compiledProgram));
  if (hasFirmware && !progress.ran) {
    return 'Firmware compiled successfully but the simulation has not run. Call run_simulation with observe_ms so the serial output can be checked.';
  }
  if (progress.ran && !progress.serialRead) {
    return 'The board was started but its serial output was not read. Call get_simulation_output with wait_ms to capture the behaviour before reporting completion.';
  }
  if (progress.ran && progress.lastSerialLength === 0) {
    return 'The simulation ran but produced no serial output. Add Serial.begin and a Serial.print line that reports the measured state, recompile, run again, and read the output. Without observable output the circuit cannot be verified.';
  }
  if (progress.lastSerial && /\b(error|failed|panic|crash|assert|exception|watchdog|guru meditation|stack overflow)\b/i.test(progress.lastSerial)) {
    return 'The serial output contains a failure. Diagnose the reported error, change one thing in the code or wiring, reset the board, recompile and run again.';
  }
  return null;
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
    model = await raceAbort(resolveModel(provider, config.model), controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
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

  const progress: RunProgress = {
    usedMutation: false,
    wiringComplete: null,
    compiled: false,
    codeDirty: false,
    ran: false,
    serialRead: false,
    lastSerial: '',
    lastSerialLength: 0,
    lastCompileError: null,
  };

  const observeRun = (run: any) => {
    if (!run) return;
    progress.ran = true;
    progress.serialRead = true;
    progress.lastSerial = String(run.serial_output ?? '');
    progress.lastSerialLength = Number(run.serial_length ?? 0);
  };
  const bestRun = (runs: any) =>
    Array.isArray(runs) && runs.length > 0
      ? runs.reduce((best: any, run: any) =>
          Number(run?.serial_length ?? 0) > Number(best?.serial_length ?? 0) ? run : best,
        )
      : null;

  const recordToolResult = (name: string, result: string) => {
    let data: any = null;
    try {
      data = JSON.parse(result);
    } catch {
      data = null;
    }
    if (MUTATION_TOOLS.has(name)) progress.usedMutation = true;

    switch (name) {
      case 'check_wiring':
        progress.wiringComplete = data?.complete === true;
        break;
      case 'build_circuit':
        if (data?.wiring) progress.wiringComplete = data.wiring.complete === true;
        progress.ran = false;
        progress.serialRead = false;
        break;
      case 'add_component':
      case 'remove_component':
      case 'wire_components':
      case 'remove_wire':
        progress.wiringComplete = null;
        progress.ran = false;
        progress.serialRead = false;
        break;
      case 'update_code':
        progress.compiled = false;
        progress.codeDirty = true;
        progress.ran = false;
        progress.serialRead = false;
        progress.lastCompileError = null;
        break;
      case 'compile_code':
      case 'compile_all_code': {
        if (data?.success) {
          progress.compiled = true;
          progress.codeDirty = false;
          progress.lastCompileError = null;
          progress.ran = false;
          progress.serialRead = false;
        } else {
          progress.compiled = false;
          progress.lastCompileError = String(data?.error ?? 'Compilation failed').slice(0, 800);
        }
        observeRun(data?.run ?? bestRun(data?.runs));
        break;
      }
      case 'run_simulation':
        if (data?.success) observeRun(bestRun(data?.runs) ?? data);
        break;
      case 'get_simulation_output':
        progress.serialRead = true;
        progress.lastSerial = String(data?.serial_output ?? '');
        progress.lastSerialLength = Number(data?.serial_length ?? 0);
        break;
      case 'reset_simulation':
        progress.ran = false;
        progress.serialRead = false;
        progress.lastSerial = '';
        progress.lastSerialLength = 0;
        break;
      default:
        break;
    }
  };

  // Some providers reject a request after a long tool turn with a bare HTTP
  // 400 and no JSON body. Retry with a minimal transcript before giving up,
  // and keep the original error if the compact retry also fails.
  let messages: Message[] = [];
  try {
  for (let providerAttempt = 0; providerAttempt < 3; providerAttempt++) {
    let completed = false;
    try {
    if (providerAttempt === 0) {
      // A long tool loop can exceed the provider request limit. Gemini then
      // replies with a non-JSON HTTP 400 ("exception parsing response"). Only
      // the recent transcript is needed to continue, and the full history is
      // still kept in the UI and in the saved conversation.
      const compactContent = (text: string) =>
        text.length > MAX_TOOL_RESULT_CHARS
          ? `${text.slice(0, 8_000)}\n[truncated for context limit]\n${text.slice(-6_000)}`
          : text;
      const history = useAgentStore
        .getState()
        .messages.filter((m) => m.role !== 'system')
        // Whitespace-only assistant text carries no meaning and can be very
        // large when a model emits thinking filler.
        .filter((m) => m.role !== 'assistant' || m.content.trim().length > 0 || (m.toolCalls?.length ?? 0) > 0)
        .map((m) => ({ ...m, content: compactContent(m.content) }));
      messages = [
        { id: 'system', role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() },
        ...history,
      ];
      compactMessages(messages);
    }

    const addToolResult = (tc: ToolCall, result: string) => {
      if (activeRequest !== controller) return;
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
    };

    let iterations = 0;
    // Tools that describe the same state are dangerous to repeat: a model can
    // alternate verify_circuit with compile_code and never make progress.
    const LOOP_SENSITIVE_TOOLS = new Set([
      'verify_circuit',
      'compile_code',
      'compile_all_code',
      'run_simulation',
      'get_simulation_output',
      'check_wiring',
      'read_code',
    ]);
    const callCounts = new Map<string, number>();
    let nudges = 0;
    let verificationNudges = 0;
    let usedTools = false;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      if (controller.signal.aborted || activeRequest !== controller) break;
      compactMessages(messages);
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
        // A model can stop mid-build. Check the live stores before accepting
        // that stop, and send it back with the exact missing stage.
        if (verificationNudges < MAX_VERIFICATION_NUDGES) {
          const nudge = await completionNudge(progress);
          if (controller.signal.aborted) break;
          if (nudge) {
            verificationNudges++;
            messages.push({
              id: crypto.randomUUID(),
              role: 'user',
              content: nudge,
              timestamp: Date.now(),
            });
            continue;
          }
        }
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
      verificationNudges = 0;
      usedTools = true;

      // Stop when the same call repeats without progress. For inspection
      // tools the name alone is enough: changing an argument slightly does
      // not count as progress when the circuit state is unchanged.
      const signatures = toolCalls.map((tc) =>
        LOOP_SENSITIVE_TOOLS.has(tc.function.name)
          ? tc.function.name
          : `${tc.function.name}:${tc.function.arguments}`,
      );
      let repeated = false;
      for (const signature of signatures) {
        const count = (callCounts.get(signature) ?? 0) + 1;
        callCounts.set(signature, count);
        if (count >= 3) repeated = true;
      }
      if (repeated) {
        agentStore.addMessage({
          role: 'assistant',
          content: `I called ${[...callCounts.entries()].find(([, count]) => count >= 3)?.[0] ?? 'a tool'} three times without progress, so I stopped to avoid a loop. The last tool result contains the evidence; make one specific change or give me a different instruction.`,
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

      for (let index = 0; index < toolCalls.length; index++) {
        const tc = toolCalls[index];
        if (controller.signal.aborted) {
          for (let rest = index; rest < toolCalls.length; rest++) {
            addToolResult(
              toolCalls[rest],
              JSON.stringify({ success: false, aborted: true, error: 'Stopped by user' }),
            );
          }
          break;
        }

        agentStore.setExecutingTool(tc.function.name);
        let result: string;
        try {
          result = await executeToolCall(tc, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            result = JSON.stringify({ success: false, aborted: true, error: 'Stopped by user' });
          } else {
            result = JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
        } finally {
          agentStore.setExecutingTool(null);
        }
        addToolResult(tc, result);
        recordToolResult(tc.function.name, result);

        if (controller.signal.aborted) {
          for (let rest = index + 1; rest < toolCalls.length; rest++) {
            addToolResult(
              toolCalls[rest],
              JSON.stringify({ success: false, aborted: true, error: 'Stopped by user' }),
            );
          }
          break;
        }
      }
      if (controller.signal.aborted) break;
    }
    completed = true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isProviderRejection =
      /\b400\b/.test(errorMsg) && /exception parsing response|Bad Request/i.test(errorMsg);
    if (
      isProviderRejection &&
      providerAttempt < 2 &&
      !controller.signal.aborted &&
      activeRequest === controller
    ) {
      // Strip history to the system prompt, the last user turn and the last
      // tool turn. The live stores still carry the verified circuit state.
      messages.splice(1, Math.max(0, messages.length - 5));
      agentStore.addMessage({
        role: 'assistant',
        content: 'The provider rejected the long transcript. I compacted the history and am continuing with the last tool result.',
      });
      continue;
    }
    if (controller.signal.aborted) return;
    if (providerAttempt > 0 && /\b400\b/.test(errorMsg)) {
      agentStore.addMessage({
        role: 'assistant',
        content: `The provider rejected the request twice after compaction. Try a new chat or a different model. ${errorMsg}`,
      });
      return;
    }
    const retiredModel = /\b404\b/.test(errorMsg) && /(no longer available|not found|does not exist|deprecated)/i.test(errorMsg)
      ? (/models\/([\w.-]+)/.exec(errorMsg)?.[1] ?? activeModelName())
      : null;
    const friendly = retiredModel
      ? `The model "${retiredModel}" is not available for this API key (it may be retired). Open AI Provider Settings with the gear icon and choose another model from the list. ${errorMsg}`
      : /503|429|\b50[02]\b/.test(errorMsg)
      ? `The model provider stayed busy after ${MAX_STREAM_ATTEMPTS} attempts. Send again in a moment, or choose another provider or model. ${errorMsg}`
      : /\b40[13]\b/.test(errorMsg)
        ? `The provider rejected the credentials. Check the API key in AI Provider Settings. ${errorMsg}`
        : /load failed|failed to fetch|networkerror|network request failed/i.test(errorMsg)
          ? `The app could not reach the model provider. Check the connection and the provider base URL. ${errorMsg}`
          : `Error: ${errorMsg}`;
    agentStore.addMessage({ role: 'assistant', content: friendly });
    }
    if (completed) break;
  }
  } finally {
    useAgentStore.getState().setRetryNotice(null);
    if (activeRequest === controller) {
      useConversationStore.getState().save(useAgentStore.getState().messages);
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
