import type {
  AntigravityExecutionMode,
  ChatMessage,
  LLMProviderType,
  ThinkingDepth,
  TokenUsage,
  ToolDefinition,
  ToolResult,
} from '@harni/types';

export type StreamChunk =
  | { type: 'token'; content: string }
  | { type: 'thinking'; thought: string }
  | {
      type: 'acp_tool';
      toolCallId: string;
      name: string;
      title: string;
      status: string;
      arguments?: Record<string, unknown>;
      output?: string;
    }
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
  subagentId?: string;
  /** The `anthropic` provider's apiKey is a Claude Pro/Max OAuth token (Bearer + oauth beta header). */
  anthropicOAuth?: boolean;
  /** OpenAI access token issued by the Codex ChatGPT subscription OAuth flow. */
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  antigravityMode?: AntigravityExecutionMode;
  autoApprove?: boolean;
  requestApproval?: (request: {
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
    title?: string;
  }) => Promise<{ approved: boolean; feedback?: string }>;
  executeAcpTool?: (
    name: string,
    args: Record<string, unknown>,
    meta: { toolCallId: string; signal?: AbortSignal },
  ) => Promise<ToolResult>;
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
  protected subagentId?: string;
  protected antigravityMode?: AntigravityExecutionMode;
  protected autoApprove?: boolean;
  protected requestApproval?: (request: {
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
    title?: string;
  }) => Promise<{ approved: boolean; feedback?: string }>;
  protected executeAcpTool?: (
    name: string,
    args: Record<string, unknown>,
    meta: { toolCallId: string; signal?: AbortSignal },
  ) => Promise<ToolResult>;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
    this.model = options.model || '';
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 8192;
    this.thinkingDepth = options.thinkingDepth ?? 'medium';
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.subagentId = options.subagentId;
    this.antigravityMode = options.antigravityMode;
    this.autoApprove = options.autoApprove;
    this.requestApproval = options.requestApproval;
    this.executeAcpTool = options.executeAcpTool;
  }

  public setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
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
