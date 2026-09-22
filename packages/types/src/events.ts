import type {
  AgentMode,
  AgentStatus,
  LLMProviderType,
  QuestionPrompt,
  SubagentInstanceInfo,
  SubagentStatus,
  TaskState,
  ThinkingDepth,
} from './agent.js';
import type { CheckpointInfo, FileDiff, FileDiagnosticsResult, FileNode, WorkspaceInfo, WorktreeStatusInfo } from './files.js';
import type { ToolCallRequest, ToolResult } from './tools.js';

/**
 * Server -> Client Event Payloads
 */
export interface ServerToClientEvents {
  'chat:token': { text: string; sessionId?: string; taskId?: string };
  'chat:thinking': { thought: string; sessionId?: string; taskId?: string };
  'task:state': TaskState & { sessionId?: string };
  'task:status': { status: AgentStatus; taskId: string; sessionId?: string };
  'question:ask': QuestionPrompt & { sessionId?: string; taskId?: string };
  'tool:request': ToolCallRequest & { sessionId?: string; taskId?: string };
  'tool:result': ToolResult & { sessionId?: string; taskId?: string };
  'file:diff': FileDiff & { sessionId?: string; taskId?: string };
  'file:content': { path: string; content: string; sessionId?: string };
  'file:diagnostics': FileDiagnosticsResult & { sessionId?: string; taskId?: string };
  'terminal:data': { data: string; sessionId?: string; terminalId?: string };
  'workspace:tree': { tree: FileNode[] };
  'workspace:dir': { path: string; children: FileNode[]; workspaceRoot?: string };
  'workspace:info': WorkspaceInfo;
  'subagent:spawned': { sessionId?: string; subagent: SubagentInstanceInfo };
  'subagent:status': { sessionId?: string; subagentId: string; status: SubagentStatus; error?: string };
  'subagent:token': { sessionId?: string; subagentId: string; text: string; isThinking?: boolean };
  'subagent:tool': { sessionId?: string; subagentId: string; toolName: string; summary?: string; status: 'start' | 'complete' | 'error' };
  'subagent:completed': { sessionId?: string; subagentId: string; result: string; durationMs: number };
  'test:result': {
    passed: boolean;
    command: string;
    output: string;
    exitCode: number;
    sessionId?: string;
    taskId?: string;
    retries?: number;
    durationMs?: number;
  };
  'checkpoint:created': { checkpoint: CheckpointInfo; sessionId?: string };
  'checkpoint:restored': { checkpointId: string; sessionId?: string; success: boolean; message: string };
  'checkpoint:pruned': { deletedCheckpoints: number; deletedBranches: number; sessionId?: string };
  'worktree:status': WorktreeStatusInfo;
  'error': { code: string; message: string; sessionId?: string; taskId?: string; details?: unknown };
}

/**
 * Client -> Server Event Payloads
 */
export interface ClientToServerEvents {
  'session:subscribe': { sessionId: string };
  'session:unsubscribe': { sessionId: string };
  'user:prompt': {
    sessionId?: string;
    prompt: string;
    mode?: AgentMode;
    provider?: LLMProviderType;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    autoApprove?: boolean;
    autoTest?: boolean;
    testCommand?: string;
    enableWorktree?: boolean;
    enableCheckpoint?: boolean;
    subagentsEnabled?: boolean;
    thinkingDepth?: ThinkingDepth;
    contextFiles?: string[];
    workspaceRoot?: string;
    history?: import('./agent.js').ChatMessage[];
    maxTurns?: number;
  };
  'task:new': { sessionId?: string } | Record<string, never>;
  'task:cancel': { taskId?: string; sessionId?: string };
  'checkpoint:rollback': { checkpointId?: string; sessionId?: string; workspaceRoot?: string };
  'checkpoint:prune': { workspaceRoot?: string; maxRetained?: number } | Record<string, never>;
  'worktree:merge': { sessionId?: string; commitMessage?: string; workspaceRoot?: string };
  'worktree:discard': { sessionId?: string; workspaceRoot?: string };
  'tool:approve': {
    sessionId?: string;
    toolCallId: string;
    approved: boolean;
    feedback?: string;
  };
  'question:answer': {
    sessionId?: string;
    toolCallId: string;
    answers: string[];
    customInput?: string;
  };
  'terminal:input': { data: string; terminalId?: string; sessionId?: string };
  'terminal:resize': { cols: number; rows: number; terminalId?: string; sessionId?: string };
  'terminal:create': { terminalId?: string; workspaceRoot?: string; cols?: number; rows?: number; shell?: string } | Record<string, never>;
  'terminal:close': { terminalId: string };
  'file:open': { path: string; workspaceRoot?: string };
  'file:save': { path: string; content: string; workspaceRoot?: string };
  'workspace:set': { path: string };
  'workspace:refresh': { workspaceRoot?: string } | Record<string, never>;
  'workspace:getDir': { path: string; workspaceRoot?: string };
}

/**
 * Generic WebSocket Message Envelope
 */
export type ServerMessage = {
  [K in keyof ServerToClientEvents]: {
    type: K;
    payload: ServerToClientEvents[K];
    timestamp?: number;
  };
}[keyof ServerToClientEvents];

export type ClientMessage = {
  [K in keyof ClientToServerEvents]: {
    type: K;
    payload: ClientToServerEvents[K];
    timestamp?: number;
  };
}[keyof ClientToServerEvents];
