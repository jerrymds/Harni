import type {
  ChatMessage,
  LLMProviderType,
  ThinkingDepth,
  TokenUsage,
  ToolDefinition,
} from '@harni/types';

export type StreamChunk =
  | { type: 'token'; content: string }
  | { type: 'thinking'; thought: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { type: 'usage'; usage: Partial<TokenUsage> };

export interface ProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingDepth?: ThinkingDepth;
  workspaceRoot?: string;
  sessionId?: string;
  /** The `anthropic` provider's apiKey is a Claude Pro/Max OAuth token (Bearer + oauth beta header). */
  anthropicOAuth?: boolean;
  /** OpenAI access token issued by the Codex ChatGPT subscription OAuth flow. */
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  requestApproval?: (request: {
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
    title?: string;
  }) => Promise<{ approved: boolean; feedback?: string }>;
}

export interface ProviderCompletionResult {
  text: string;
  thinking?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    thoughtSignature?: string;
  }>;
  usage?: Partial<TokenUsage>;
}

export abstract class BaseLLMProvider {
  public abstract readonly providerType: LLMProviderType;
  public abstract readonly defaultModel: string;
  public sessionId?: string;

  protected apiKey?: string;
  protected baseURL?: string;
  protected model: string;
  protected temperature: number;
  protected maxTokens: number;
  protected thinkingDepth: ThinkingDepth;
  protected workspaceRoot?: string;
  protected requestApproval?: (request: {
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
    title?: string;
  }) => Promise<{ approved: boolean; feedback?: string }>;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
    this.model = options.model || '';
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 8192;
    this.thinkingDepth = options.thinkingDepth ?? 'medium';
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.requestApproval = options.requestApproval;
  }

  public getApiKey(): string | undefined {
    return this.apiKey;
  }

  public getBaseURL(): string | undefined {
    return this.baseURL;
  }

  public abstract streamCompletion(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<ProviderCompletionResult>;
}
