import type {
  AgentStatus,
  AutoTestConfig,
  ChatMessage,
  TaskState,
  ToolCall,
} from './agent.js';
import type { ToolDefinition, ToolResult } from './tools.js';
import type { FileDiagnosticsResult } from './files.js';
import type { ServerToClientEvents } from './events.js';

export enum PluginPriority {
  ENVIRONMENT = 10,
  SNAPSHOT = 20,
  DISCOVERY = 30,
  CONTEXT = 40,
  GUARD = 50,
  DIAGNOSTICS = 60,
  VERIFICATION = 70,
  TELEMETRY = 80,
}

export type WorkflowPluginCategory =
  | 'environment'
  | 'context'
  | 'guard'
  | 'diagnostics'
  | 'verification'
  | 'telemetry';

export interface WorkflowPluginMetadata {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  category?: WorkflowPluginCategory;
  isBuiltin?: boolean;
  applyToSubagents?: boolean;
}

export interface SystemPromptSection {
  id: string;
  title?: string;
  content: string;
  order?: number;
}

export type CompletionGateResult =
  | { action: 'allow'; appendedMessages?: ChatMessage[] }
  | { action: 'continue_loop'; injectedMessages?: ChatMessage[]; reason?: string }
  | { action: 'complete_with_messages'; appendedMessages: ChatMessage[] };

export interface ToolCallMiddlewareContext {
  toolCall: ToolCall;
  canonicalToolName: string;
  requiresApproval: boolean;
  isMcpTool: boolean;
  mcpToolAllowedReadOnly?: boolean;
  metadata: Record<string, unknown>;
}

export type ToolCallNext = () => Promise<ToolResult>;

export interface WorkflowPluginContext {
  readonly sessionId: string;
  readonly taskId: string;
  readonly isSubagent: boolean;
  readonly subagentId?: string;
  readonly subagentRole?: string;
  readonly depth?: number;
  readonly taskState?: TaskState;
  readonly signal?: AbortSignal;
  getWorkspaceRoot(): string;
  setWorkspaceRoot(newRoot: string, meta?: { isWorktree?: boolean; branch?: string }): void;
  getMainWorkspaceRoot(): string;
  getPluginState<T>(pluginId: string, initializer?: () => T): T;
  setPluginState<T>(pluginId: string, state: T): void;
  addMessage(message: ChatMessage): void;
  getMessages(): ChatMessage[];
  setStatus(status: AgentStatus): void;
  syncTaskState(): void;
  emitEvent<K extends keyof ServerToClientEvents & string>(event: K, payload: ServerToClientEvents[K]): void;
  invokeLLM(prompt: string, systemPrompt?: string): Promise<string>;
  requestToolApproval?(toolCall: ToolCall): Promise<{ approved: boolean; feedback?: string }>;
  notifyCodeModified?(filePath?: string): void;
  notifyDiagnostics?(diag: FileDiagnosticsResult): void;
  notifyTerminalData?(data: string): void;
  isSubagentsEnabled?(): boolean;
  isStrictOrchestrationEnabled?(): boolean;
  isMcpToolAllowedReadOnly?(toolName: string): boolean;
  isReadOnlySubagentType?(typeName: string): boolean;
  getAutoTestConfig?(): AutoTestConfig | undefined;
  recordToolStart?(): void;
}

export interface WorkflowPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priority?: number;
  readonly category?: WorkflowPluginCategory;
  readonly isBuiltin?: boolean;
  enabled: boolean;
  applyToSubagents?: boolean;
  onTaskStart?(ctx: WorkflowPluginContext, options: Record<string, unknown>): void | Promise<void>;
  onResolveTools?(ctx: WorkflowPluginContext, tools: ToolDefinition[]): ToolDefinition[] | Promise<ToolDefinition[]>;
  onBuildSystemPrompt?(ctx: WorkflowPluginContext): SystemPromptSection[] | Promise<SystemPromptSection[]>;
  onToolCall?(ctx: WorkflowPluginContext, toolCtx: ToolCallMiddlewareContext, next: ToolCallNext): Promise<ToolResult>;
  onBeforeComplete?(ctx: WorkflowPluginContext): CompletionGateResult | Promise<CompletionGateResult>;
  onTaskCompleted?(ctx: WorkflowPluginContext): void | Promise<void>;
  onTaskError?(ctx: WorkflowPluginContext, error: unknown): { handled: boolean; customMessage?: ChatMessage } | Promise<{ handled: boolean; customMessage?: ChatMessage }>;
  onSessionReset?(sessionId?: string): void | Promise<void>;
  onDispose?(): void | Promise<void>;
}
