import type {
  FileDiff,
  FileDiagnosticsResult,
  LLMProviderType,
  SubagentInstanceInfo,
  SubagentStatus,
  SubagentStructuredReport,
  ThinkingDepth,
  TokenUsage,
} from '@harni/types';
import type { BaseLLMProvider } from '../providers/baseProvider.js';

export interface SpawnSubagentParams {
  typeName: string;
  role: string;
  prompt: string;
  sessionId: string;
  parentId: string;
  depth?: number;
  model?: string;
  parentModel?: string;
  provider?: LLMProviderType;
  workspaceRoot?: string;
  customProvider?: BaseLLMProvider;
  apiKey?: string;
  baseURL?: string;
  thinkingDepth?: ThinkingDepth;
  parentSignal?: AbortSignal;
  onFileDiff?: (diff: FileDiff) => void;
  onDiagnostics?: (data: FileDiagnosticsResult) => void;
  onTerminalData?: (data: string) => void;
  onCodeModified?: () => void;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
  openaiAccountId?: string;
  background?: boolean;
  maxTokensBudget?: number;
  timeoutMs?: number;
  isolation?: 'inherit' | 'worktree';
  autoMergeWorktree?: boolean;
}

export interface SubagentExecutionResult {
  id: string;
  typeName: string;
  role: string;
  status: SubagentStatus;
  result: string;
  error?: string;
  durationMs: number;
  toolCallCount: number;
  tokenUsage?: TokenUsage;
  codeModified?: boolean;
  structuredReport?: SubagentStructuredReport;
  background?: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeMerged?: boolean;
}

export interface SubagentManagerEvents {
  'subagent:spawned': (payload: { sessionId: string; subagent: SubagentInstanceInfo }) => void;
  'subagent:status': (payload: { sessionId: string; subagentId: string; status: SubagentStatus; error?: string }) => void;
  'subagent:token': (payload: { sessionId: string; subagentId: string; text: string; isThinking?: boolean }) => void;
  'subagent:tool': (payload: { sessionId: string; subagentId: string; toolName: string; summary?: string; status: 'start' | 'complete' | 'error' }) => void;
  'subagent:completed': (payload: {
    sessionId: string;
    subagentId: string;
    status: SubagentStatus;
    result: string;
    error?: string;
    durationMs: number;
    tokenUsage?: TokenUsage;
    codeModified?: boolean;
    structuredReport?: SubagentStructuredReport;
    worktreePath?: string;
    worktreeBranch?: string;
  }) => void;
}
