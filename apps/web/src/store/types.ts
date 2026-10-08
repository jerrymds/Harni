import type {
  AgentMode,
  AgentSkill,
  AgentStatus,
  AnthropicAuthInfo,
  ChatMessage,
  ChatSession,
  FileDiff,
  FileNode,
  GoogleAuthInfo,
  LLMProviderType,
  ModelInfo,
  OpenAIAuthInfo,
  QuestionPrompt,
  SubagentInstanceInfo,
  ThinkingDepth,
  TokenUsage,
  ToolCallRequest,
  WorkspaceFolder,
  WorkspaceInfo,
} from '@harni/types';

export type {
  AgentMode,
  AgentSkill,
  AgentStatus,
  AnthropicAuthInfo,
  ChatMessage,
  ChatSession,
  FileDiff,
  FileNode,
  GoogleAuthInfo,
  LLMProviderType,
  ModelInfo,
  OpenAIAuthInfo,
  QuestionPrompt,
  SubagentInstanceInfo,
  ThinkingDepth,
  TokenUsage,
  ToolCallRequest,
  WorkspaceFolder,
  WorkspaceInfo,
};

export interface ChatSliceState {
  status: AgentStatus;
  sessions: ChatSession[];
  currentSessionId: string;
  messages: ChatMessage[];
  activeThinking: string;
  pendingApproval: ToolCallRequest | null;
  pendingQuestion: QuestionPrompt | null;
  tokenUsage: TokenUsage;
  selectedMode: AgentMode;
  selectedProvider: LLMProviderType;
  selectedModel: string;
  availableModels: Record<string, ModelInfo[]>;
  isLoadingModels: boolean;
  subagents: Record<string, SubagentInstanceInfo[]>;
}

export interface ChatSliceActions {
  sendPrompt: (prompt: string, contextFiles?: string[]) => void;
  newSession: (folderId?: string) => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  moveSessionToFolder: (sessionId: string, targetFolderId: string) => void;
  clearMessages: () => void;
  cancelTask: () => void;
  approveTool: (toolCallId: string, approved: boolean, feedback?: string) => void;
  answerQuestion: (toolCallId: string, answers: string[], customInput?: string) => void;
  setMode: (mode: AgentMode) => void;
  setProvider: (provider: LLMProviderType) => void;
  setModel: (model: string) => void;
  fetchModels: (provider?: LLMProviderType, apiKey?: string, baseURL?: string) => Promise<void>;
  killSubagent: (subagentId: string) => void;
}

export type ChatSlice = ChatSliceState & ChatSliceActions;

export interface WorkspaceSliceState {
  connected: boolean;
  folders: WorkspaceFolder[];
  activeFolderId: string;
  fileTree: FileNode[];
  workspaceInfo: WorkspaceInfo | null;
  activeFile: { path: string; content: string } | null;
  activeDiff: FileDiff | null;
  skills: AgentSkill[];
  isLoadingSkills: boolean;
  fileDiagnostics: Record<string, import('@harni/types').FileDiagnostic[]>;
  checkpoints: import('@harni/types').CheckpointInfo[];
  activeWorktrees: Record<string, { isWorktree: boolean; branch?: string; path?: string }>;
  isRevertingCheckpoint: boolean;
  ws: WebSocket | null;
  onTerminalDataCallback: ((data: string) => void) | null;
}

export interface WorkspaceSliceActions {
  connect: (url?: string) => void;
  createFolder: (name: string, path?: string) => string;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  updateFolderPath: (folderId: string, path: string) => void;
  setActiveFolder: (folderId: string) => void;
  syncActiveWorkspace: (targetFolderId?: string) => void;
  toggleFolderCollapse: (folderId: string) => void;
  loadDirectory: (path: string) => void;
  openFile: (path: string) => void;
  saveActiveFile: (content: string) => void;
  closeActiveFile: () => void;
  setActiveDiff: (diff: FileDiff | null) => void;
  fetchSkills: (refresh?: boolean) => Promise<void>;
  rollbackCheckpoint: (sessionId?: string, checkpointId?: string) => Promise<boolean>;
  mergeWorktree: (sessionId: string, commitMessage?: string) => Promise<boolean>;
  discardWorktree: (sessionId: string) => Promise<boolean>;
  fetchCheckpoints: (workspaceRoot?: string) => Promise<void>;
  pruneCheckpoints: (maxRetained?: number) => Promise<void>;
  sendTerminalInput: (data: string) => void;
  resizeTerminal: (cols: number, rows: number) => void;
  registerTerminalDataCallback: (cb: (data: string) => void) => void;
}

export type WorkspaceSlice = WorkspaceSliceState & WorkspaceSliceActions;

export interface SettingsSliceState {
  thinkingDepth: ThinkingDepth;
  autoApprove: boolean;
  customApiKey: string;
  customBaseUrl: string;
  providerBaseUrls: Record<string, string>;
  customProviderName: string;
  isSettingsOpen: boolean;
  theme: string;
  fontSize: string;
  codeFont: string;
  compactMode: boolean;
  mcpEnabled: boolean;
  mcpConfig: string;
  serverAuthToken: string;
  autoTestEnabled: boolean;
  autoTestCommand: string;
  gitCheckpointEnabled: boolean;
  worktreeIsolationEnabled: boolean;
  subagentsEnabled: boolean;
  contextWindow: number | null;
  modelContextWindows: Record<string, number>;
}

export interface SettingsSliceActions {
  setThinkingDepth: (depth: ThinkingDepth) => void;
  setAutoApprove: (enabled: boolean) => void;
  setCustomApiKey: (key: string) => void;
  setCustomBaseUrl: (url: string) => void;
  setProviderBaseUrl: (provider: string, url: string) => void;
  setCustomProviderName: (name: string) => void;
  setTheme: (theme: string) => void;
  setFontSize: (size: string) => void;
  setCodeFont: (font: string) => void;
  setCompactMode: (compact: boolean) => void;
  setServerAuthToken: (token: string) => void;
  setMcpEnabled: (enabled: boolean) => void;
  setMcpConfig: (config: string) => void;
  setAutoTestEnabled: (enabled: boolean) => void;
  setAutoTestCommand: (cmd: string) => void;
  setGitCheckpointEnabled: (enabled: boolean) => void;
  setWorktreeIsolationEnabled: (enabled: boolean) => void;
  setSubagentsEnabled: (enabled: boolean) => void;
  setContextWindow: (contextWindow: number | null) => void;
  setModelContextWindow: (modelId: string, contextWindow: number | null) => void;
  setSettingsOpen: (open: boolean) => void;
}

export type SettingsSlice = SettingsSliceState & SettingsSliceActions;

export interface AuthSliceState {
  credentials: Record<string, { configured: boolean; maskedKey?: string }>;
  googleAuthInfo: GoogleAuthInfo | null;
  anthropicAuthInfo: AnthropicAuthInfo | null;
  openaiAuthInfo: OpenAIAuthInfo | null;
}

export interface AuthSliceActions {
  initFromDB: () => Promise<void>;
  fetchCredentials: () => Promise<void>;
  saveCredential: (provider: string, apiKey: string) => Promise<void>;
  deleteCredential: (provider: string) => Promise<void>;
  fetchGoogleAuthStatus: () => Promise<void>;
  saveGoogleConfig: (clientId?: string, clientSecret?: string) => Promise<boolean>;
  loginWithGoogle: (email?: string, name?: string) => Promise<boolean>;
  logoutGoogle: () => Promise<void>;
  fetchAnthropicAuthStatus: () => Promise<void>;
  startAnthropicLogin: () => Promise<boolean>;
  submitAnthropicCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  logoutAnthropic: () => Promise<void>;
  fetchOpenAIAuthStatus: () => Promise<void>;
  loginWithOpenAI: () => Promise<boolean>;
  logoutOpenAI: () => Promise<void>;
}

export type AuthSlice = AuthSliceState & AuthSliceActions;

export type AgentStoreState = ChatSlice & WorkspaceSlice & SettingsSlice & AuthSlice;
