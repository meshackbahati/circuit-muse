export type ProviderId = 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'openrouter' | 'moonshot' | 'custom';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  isCustom?: boolean;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  providerId?: ProviderId;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChunk {
  content?: string;
  toolCalls?: Partial<ToolCall>[];
  done: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatParams {
  messages: Message[];
  model?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  id: ProviderId;
  chatStream(params: ChatParams): AsyncGenerator<StreamChunk>;
  chat(params: ChatParams): Promise<Message>;
  listModels?(): Promise<string[]>;
}
