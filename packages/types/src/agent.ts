/**
 * Agent lifecycle and execution states
 */
export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'thinking'
  | 'streaming'
  | 'tool_request'
  | 'waiting_approval'
  | 'waiting_user_input'
  | 'executing_tool'
  | 'testing'
  | 'completed'
  | 'error'
  | 'cancelled';

/**
 * Message roles supported by the Agent loop
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Supported LLM Providers
 */
export type LLMProviderType =
  | 'cline'
  | 'anthropic'
  | 'openai'
  | 'antigravity'
  | 'ollama'
  | 'openrouter'
  | 'opencode'
  | 'custom';

/**
 * Google / Antigravity Authentication Status
 */
export interface GoogleAuthInfo {
  authenticated: boolean;
  email?: string;
  name?: string;
  picture?: string;
  authenticatedAt?: number;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Anthropic / Claude (Pro/Max subscription) OAuth Authentication Status
 */
export interface AnthropicAuthInfo {
  authenticated: boolean;
  email?: string;
  organization?: string;
  plan?: string;
  authenticatedAt?: number;
}

/** OpenAI / ChatGPT Plus subscription OAuth Authentication Status */
export interface OpenAIAuthInfo {
  authenticated: boolean;
  email?: string;
  plan?: string;
  authenticatedAt?: number;
}

/**
 * Agent Mode
 */
export type AgentMode = 'code' | 'architect' | 'ask' | 'test' | 'custom';

/**
 * Model reasoning / thinking depth level
 */
export type ThinkingDepth = 'off' | 'low' | 'medium' | 'high' | 'ultra';

/**
 * Model info structure returned dynamically from API or presets
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

/**
 * API Rate Limit & Quota Information
 */
export interface RateLimitInfo {
  isRateLimit: boolean;
  limitType?: 'RPM' | 'TPM' | 'RPD' | 'QUOTA' | 'RATE_LIMIT';
  model?: string;
  provider?: string;
  retryAfter?: string;
  details?: string;
}

/**
 * Chat message within the task conversation history
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  name?: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolResult?: {
    toolCallId?: string;
    isError?: boolean;
    output: unknown;
    summary?: string;
  };
  rateLimitInfo?: RateLimitInfo;
  timestamp: number;
}

import type { ToolCallRequest } from './tools.js';

/**
 * Configuration for Auto Test-Driven Repair loop
 */
export interface AutoTestConfig {
  enabled?: boolean;
  testCommand?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Real-time Auto Test execution status
 */
export interface AutoTestStatus {
  running: boolean;
  command?: string;
  passed?: boolean;
  retries: number;
  lastError?: string;
  durationMs?: number;
}

/**
 * Full task state snapshot
 */
export interface TaskState {
  id: string;
  sessionId?: string;
  status: AgentStatus;
  prompt: string;
  currentTurn: number;
  maxTurns: number;
  mode: AgentMode;
  provider: LLMProviderType;
  model: string;
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
  autoTestStatus?: AutoTestStatus;
  checkpointId?: string;
  isWorktree?: boolean;
  worktreeBranch?: string;
  worktreePath?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace project folder
 */
export interface WorkspaceFolder {
  id: string;
  name: string;
  path?: string;
  createdAt: number;
  isCollapsed?: boolean;
  sortOrder?: number;
}

/**
 * Interactive Question Prompt for human clarification
 */
export interface QuestionPrompt {
  toolCallId: string;
  question: string;
  options?: string[];
  isMultiSelect?: boolean;
  allowCustomInput?: boolean;
}

/**
 * Chat conversation session
 */
export interface ChatSession {
  id: string;
  folderId?: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  messageCount: number;
  mode: AgentMode;
  provider?: LLMProviderType;
  model?: string;
  messages?: ChatMessage[];
  status?: AgentStatus;
  activeThinking?: string;
  pendingApproval?: ToolCallRequest | null;
  pendingQuestion?: QuestionPrompt | null;
  tokenUsage?: TokenUsage;
}

export type SubagentRunnerType = 'internal' | 'agy';

/**
 * Options specifically for the Antigravity CLI ('agy') subagent runner
 */
export interface AgyRunnerOptions {
  binaryPath?: string;
  effort?: 'low' | 'medium' | 'high';
  mode?: 'accept-edits' | 'plan';
  dangerouslySkipPermissions?: boolean;
  timeoutMs?: number;
}

/**
 * Subagent Definition metadata and capabilities
 */
export interface SubagentDefinition {
  name: string;
  description: string;
  role?: string;
  systemPrompt: string;
  allowedTools?: string[];
  enableWriteTools?: boolean;
  enableSubagentTools?: boolean;
  enableMcpTools?: boolean;
  model?: string;
  maxTurns?: number;
  runnerType?: SubagentRunnerType;
  agyOptions?: AgyRunnerOptions;
}

/**
 * Subagent execution lifecycle states
 */
export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'idle'
  | 'waiting_for_input'
  | 'completed'
  | 'error'
  | 'cancelled';

/**
 * Live Subagent instance state snapshot
 */
export interface SubagentInstanceInfo {
  id: string;
  parentId: string;
  sessionId: string;
  typeName: string;
  role: string;
  prompt: string;
  status: SubagentStatus;
  model?: string;
  depth: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  toolCallCount?: number;
  runnerType?: SubagentRunnerType;
  conversationId?: string;
  currentToolSummary?: string;
}


