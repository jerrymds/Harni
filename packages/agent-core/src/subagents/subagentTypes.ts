import type {
  LLMProviderType,
  SubagentInstanceInfo,
  SubagentStatus,
  ThinkingDepth,
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
  provider?: LLMProviderType;
  workspaceRoot?: string;
  customProvider?: BaseLLMProvider;
  apiKey?: string;
  baseURL?: string;
  thinkingDepth?: ThinkingDepth;
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
}

export interface SubagentManagerEvents {
  'subagent:spawned': (payload: { sessionId: string; subagent: SubagentInstanceInfo }) => void;
  'subagent:status': (payload: { sessionId: string; subagentId: string; status: SubagentStatus; error?: string }) => void;
  'subagent:token': (payload: { sessionId: string; subagentId: string; text: string; isThinking?: boolean }) => void;
  'subagent:tool': (payload: { sessionId: string; subagentId: string; toolName: string; summary?: string; status: 'start' | 'complete' | 'error' }) => void;
  'subagent:completed': (payload: { sessionId: string; subagentId: string; result: string; durationMs: number }) => void;
}
